const { SSMClient, GetParameterCommand, GetParametersCommand } = require('@aws-sdk/client-ssm');
const axios = require('axios');
const ConfigLogger = require('./lib/logger');

let isQuietMode = false;
let log = new ConfigLogger();

let configInitialized = false;
let initializationPromise = null;
let configMap = null;  // Will be set by the user
let ssmCache = {};  // Cache for SSM parameter values

const isLambda = !!(process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME);

// Initialize SSM client
let ssmClient = new SSMClient({ region: process.env.AWS_REGION });

// Helper function to fetch from Lambda extension via localhost:2773
async function getFromLambdaExtension(parameterName, kmsKeyId = null) {
  // URL encode the parameter name
  const encodedName = encodeURIComponent(parameterName);
  const endpoint = `http://localhost:2773/systemsmanager/parameters/get?name=${encodedName}&withDecryption=true`;
  const headers = {
    'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN
  };
  
  if (kmsKeyId) {
    headers['X-Aws-Kms-Key-Id'] = kmsKeyId;
  }

  try {
    log.debug(`Fetching SSM parameter ${parameterName} via Lambda extension`);
    const response = await axios.get(endpoint, { headers });
    if (!response.data.Parameter?.Value) {
      log.warn(`SSM parameter ${parameterName} not found via Lambda extension`);
      return null;
    }
    log.debug(`Successfully fetched SSM parameter ${parameterName} via Lambda extension`);
    return response.data.Parameter.Value;
  } catch (err) {
    // Improve error message based on status code
    if (err.response?.status === 404) {
      log.warn(`SSM parameter ${parameterName} not found via Lambda extension`);
    } else {
      log.warn(`Error fetching SSM parameter ${parameterName} via Lambda extension: ${err.message}`);
    }
    return null;
  }
}

// Helper function to fetch a single parameter from SSM
async function getParameterFromSSM(parameterName, kmsKeyId = null) {
  const params = {
    Name: parameterName,
    WithDecryption: true
  };

  if (kmsKeyId) {
    params.KeyId = kmsKeyId;
  }

  try {
    const command = new GetParameterCommand(params);
    const response = await ssmClient.send(command);
    return response.Parameter.Value;
  } catch (err) {
    // Improve error messages based on error code
    if (err.name === 'ParameterNotFound') {
      log.warn(`SSM parameter ${parameterName} not found in this AWS account`);
    } else if (err.name === 'AccessDeniedException') {
      log.warn(`Access denied to SSM parameter ${parameterName}. Please check AWS credentials and permissions`);
    } else {
      log.warn(`Error fetching SSM parameter ${parameterName}: ${err.message}`);
    }
    return null;
  }
}

// Helper function to fetch all parameters
async function getBatchFromSSM(parameterNames, kmsKeyId = null) {
  // If using a custom KMS key, we need to fetch parameters individually
  if (kmsKeyId) {
    log.debug('Fetching SSM parameters individually due to custom KMS key');
    const values = {};
    for (const paramName of parameterNames) {
      const value = await getParameterFromSSM(paramName, kmsKeyId);
      if (value !== null) {
        values[paramName] = value;
        if (!isQuietMode) {
          log.debug(`Successfully fetched SSM parameter ${paramName}`);
        }
      } else {
        log.warn(`SSM parameter ${paramName} was not found.`);
      }
    }
    return values;
  }

  const params = {
    Names: parameterNames,
    WithDecryption: true
  };

  try {
    const command = new GetParametersCommand(params);
    const response = await ssmClient.send(command);
    const values = {};
    
    response.Parameters.forEach(param => {
      values[param.Name] = param.Value;
      if (!isQuietMode) {
        log.debug(`Successfully fetched SSM parameter ${param.Name}`);
      }
    });

    response.InvalidParameters.forEach(param => {
      log.warn(`SSM parameter ${param} was not found.`);
    });

    return values;
  } catch (err) {
    log.warn(`Error fetching batch SSM parameters via SSM API: ${err.message}`);
    return {};
  }
}

// Function to convert values based on the expected type
function convertValue(value, type) {
  // Validate the type is supported
  const validTypes = ['string', 'int', 'float', 'bool'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid type "${type}". Supported types are: ${validTypes.join(', ')}`);
  }

  switch (type) {
    case 'int':
      return parseInt(value, 10);
    case 'float':
      return parseFloat(value);
    case 'bool':
      // Enhanced boolean conversion
      if (value === 'true' || value === '1' || value === 1) {
        return true;
      } else if (value === 'false' || value === '0' || value === 0) {
        return false;
      } else {
        // Preserve the original string for error message clarity
        throw new Error(`Invalid boolean value: "${value}". Expected "true", "false", "1", "0"`);
      }
    case 'string':
    default:
      return value;  // No conversion needed for strings
  }
}

// Function to preload and populate the config object
async function loadConfig(kmsKeyId = null) {
  if (configInitialized) {
    return;
  }

  const ssmParameters = Object.values(configMap)
    .filter(({ fallbackSSM }) => fallbackSSM)
    .map(({ fallbackSSM }) => fallbackSSM);

  let ssmValues = {};
  if (ssmParameters.length > 0) {
    if (isLambda) {
      // Try to fetch from Lambda extension first
      let lambdaExtensionFailed = false;
      for (const param of ssmParameters) {
        const value = await getFromLambdaExtension(param);
        if (value === null) {
          lambdaExtensionFailed = true;
          break;
        }
        ssmValues[param] = value;
      }

      // If Lambda extension failed, clear ssmValues to fetch all from SSM API
      if (lambdaExtensionFailed) {
        ssmValues = {};
      }
    }

    // If not in Lambda or Lambda extension failed, fetch all from SSM API
    if (Object.keys(ssmValues).length === 0) {
      ssmValues = await getBatchFromSSM(ssmParameters, kmsKeyId);
    }

    // Store SSM values in cache for later access
    ssmCache = { ...ssmValues };
  }

  const configValues = [];

  for (const [key, { envVar, fallbackSSM, fallbackStatic, type }] of Object.entries(configMap)) {
    let value;
    let source = 'env';

    if (process.env[envVar]) {
      value = process.env[envVar];
    } else if (fallbackSSM) {
      value = ssmValues[fallbackSSM] || null;
      if (value !== null) {
        source = 'ssm';
      }
    }

    if (value === null || value === undefined) {
      value = fallbackStatic;
      if (value !== undefined) {
        source = 'default';
      }
    }

    if (value === null || value === undefined) {
      throw new Error(`Missing configuration value for ${key}`);
    }

    const convertedValue = convertValue(value, type);
    process.env[envVar] = String(convertedValue);

    configValues.push({ key, value: convertedValue, type, source });
  }

  const sourceCounts = {};
  configValues.forEach(({ source }) => {
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });

  const summary = Object.entries(sourceCounts)
    .map(([source, count]) => `${count} from ${source}`)
    .join(', ');
  log.summary(`Config loaded: ${summary}`);

  if (!isQuietMode) {
    log.info('Loaded configuration values:');
    
    configValues.forEach(({ key, value, type, source }) => {
      switch (type) {
        case 'string':
          log.info(`  ${key}: (string) (${value.length} characters) (${source})`);
          break;
        case 'int':
          const intDigits = String(value).replace(/^-/, '').length; // Count digits, ignoring minus sign
          log.info(`  ${key}: (int) (${intDigits} digits) (${source})`);
          break;
        case 'float':
          const floatStr = String(value);
          const decimalPlaces = floatStr.includes('.') ? floatStr.split('.')[1].length : 0;
          log.info(`  ${key}: (float) (${decimalPlaces} decimal places) (${source})`);
          break;
        case 'bool':
          log.info(`  ${key}: (bool) (${source})`);
          break;
        default:
          log.info(`  ${key}: (${type}) (${source})`);
      }
    });
  }

  configInitialized = true;
}

// Function to initialize and populate the config object
async function initializeConfig(kmsKeyId = null, options = {}) {
  if (!configMap) {
    throw new Error('Configuration map not set. Call config.configMap = {...} before initializing.');
  }

  if (configInitialized) {
    return Promise.resolve();
  }

  // If there's already an initialization in progress, return that promise
  if (initializationPromise) {
    return initializationPromise;
  }

  // Set quiet mode before creating the promise
  if (options.quiet !== undefined) {
    isQuietMode = options.quiet;
    log.setQuietMode(options.quiet);
  }

  // Create and store the promise before doing any async work
  initializationPromise = loadConfig(kmsKeyId).catch(error => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

// Function to get config values
function getConfig(key) {
  const { envVar, fallbackSSM, fallbackStatic, type } = configMap[key];
  
  if (!configInitialized) {
    // If not initialized, return fallback or throw error
    if (fallbackStatic !== undefined) {
      return convertValue(fallbackStatic, type);
    }
    throw new Error('Config not initialized. Call initializeConfig() first.');
  }
  
  // Always check environment variable first (allowing for dynamic updates)
  if (process.env[envVar] !== undefined) {
    return convertValue(process.env[envVar], type);
  }
  
  // If we've stored an SSM value during initialization, use that
  if (fallbackSSM && ssmCache[fallbackSSM] !== undefined) {
    return convertValue(ssmCache[fallbackSSM], type);
  }
  
  // Finally, fall back to static value
  if (fallbackStatic !== undefined) {
    return convertValue(fallbackStatic, type);
  }
  
  throw new Error(`Missing configuration value for ${key}`);
}

// Create a proxy object for easy access to config values
const config = new Proxy({}, {
  get(target, prop) {
    if (prop === 'initializeConfig') {
      return initializeConfig;
    }
    if (prop === 'configMap') {
      return configMap;
    }
    if (prop === 'getConfig') {
      return getConfig;
    }
    if (prop === 'log') {
      return log;
    }
    if (prop === 'isQuietMode') {
      return isQuietMode;
    }
    if (prop === 'ssmClient') {
      return ssmClient;
    }
    return getConfig(prop);
  },
  set(target, prop, value) {
    if (prop === 'configMap') {
      configMap = value;
      return true;
    }
    if (prop === 'log') {
      log = value;
      return true;
    }
    if (prop === 'isQuietMode') {
      isQuietMode = value;
      log.setQuietMode(value);
      return true;
    }
    if (prop === 'ssmClient') {
      ssmClient = value;
      return true;
    }
    return false;
  }
});

module.exports = config;

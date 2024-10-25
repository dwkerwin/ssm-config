const { SSMClient, GetParameterCommand, GetParametersCommand } = require('@aws-sdk/client-ssm');
const axios = require('axios');
const logDebug = (...args) => console.debug(...args);
const logInfo = (...args) => console.info(...args);
const logWarn = (...args) => console.warn(...args);
const logError = (...args) => console.error(...args);

let configInitialized = false;
let configMap = null;  // Will be set by the user

const isLambda = !!(process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME);

// Initialize SSM client
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

// Helper function to fetch from Lambda extension via localhost:2773
async function getFromLambdaExtension(parameterName) {
  const endpoint = `http://localhost:2773/systemsmanager/parameters/get?name=${parameterName}&withDecryption=true`;
  try {
    logDebug(`Fetching SSM parameter ${parameterName} via Lambda extension`);
    const response = await axios.get(endpoint);
    if (!response.data.Parameter?.Value) {
      logWarn(`SSM parameter ${parameterName} not found via Lambda extension`);
      return null;
    }
    logDebug(`Successfully fetched SSM parameter ${parameterName} via Lambda extension`);
    return response.data.Parameter.Value;
  } catch (err) {
    // Improve error message based on status code
    if (err.response?.status === 404) {
      logWarn(`SSM parameter ${parameterName} not found via Lambda extension`);
    } else {
      logWarn(`Error fetching SSM parameter ${parameterName} via Lambda extension: ${err.message}`);
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
      logWarn(`SSM parameter ${parameterName} not found in this AWS account`);
    } else if (err.name === 'AccessDeniedException') {
      logWarn(`Access denied to SSM parameter ${parameterName}. Please check AWS credentials and permissions`);
    } else {
      logWarn(`Error fetching SSM parameter ${parameterName}: ${err.message}`);
    }
    return null;
  }
}

// Helper function to fetch all parameters
async function getBatchFromSSM(parameterNames, kmsKeyId = null) {
  // If using a custom KMS key, we need to fetch parameters individually
  if (kmsKeyId) {
    logDebug('Fetching SSM parameters individually due to custom KMS key');
    const values = {};
    for (const paramName of parameterNames) {
      const value = await getParameterFromSSM(paramName, kmsKeyId);
      if (value !== null) {
        values[paramName] = value;
        logDebug(`Successfully fetched SSM parameter ${paramName}`);
      } else {
        logWarn(`SSM parameter ${paramName} was not found.`);
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
      logDebug(`Successfully fetched SSM parameter ${param.Name}`);
    });

    response.InvalidParameters.forEach(param => {
      logWarn(`SSM parameter ${param} was not found.`);
    });

    return values;
  } catch (err) {
    logWarn(`Error fetching batch SSM parameters via SSM API: ${err.message}`);
    return {};
  }
}

// Function to convert values based on the expected type
function convertValue(value, type) {
  switch (type) {
    case 'int':
      return parseInt(value, 10);
    case 'bool':
      return value === 'true';
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

  logInfo('Initializing config');

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

  logInfo('Config initialization complete');
  logInfo('Loaded configuration values:');
  
  configValues.forEach(({ key, value, type, source }) => {
    switch (type) {
      case 'string':
        logInfo(`  ${key}: (string) (${value.length} characters) (${source})`);
        break;
      case 'int':
        const digits = String(value).replace(/^-/, '').length; // Count digits, ignoring minus sign
        logInfo(`  ${key}: (int) (${digits} digits) (${source})`);
        break;
      case 'bool':
        logInfo(`  ${key}: (bool) (${source})`);
        break;
      default:
        logInfo(`  ${key}: (${type}) (${source})`);
    }
  });

  configInitialized = true;
}

// Function to initialize and populate the config object
async function initializeConfig(kmsKeyId = null) {
  if (!configMap) {
    throw new Error('Configuration map not set. Call config.configMap = {...} before initializing.');
  }

  if (configInitialized) {
    return;
  }

  await loadConfig(kmsKeyId);
}

// Function to get config values
function getConfig(key) {
  const { envVar, fallbackStatic } = configMap[key];
  if (!configInitialized) {
    // If not initialized, return fallback or throw error
    if (fallbackStatic !== undefined) {
      return convertValue(fallbackStatic, configMap[key].type);
    }
    throw new Error('Config not initialized. Call initializeConfig() first.');
  }
  return convertValue(process.env[envVar], configMap[key].type);
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
    return getConfig(prop);
  },
  set(target, prop, value) {
    if (prop === 'configMap') {
      configMap = value;
      return true;
    }
    return false;
  }
});

module.exports = config;

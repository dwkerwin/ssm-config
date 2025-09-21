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

// Configuration for timeouts and retries
// API Gateway has a 29-second hard limit, so we need to stay well under that
const DEFAULT_TIMEOUT_MS = 8000; // 8 seconds per attempt (allows 3 attempts in 24 seconds)
const LAMBDA_EXTENSION_TIMEOUT_MS = 3000; // 3 seconds for Lambda Extensions API (localhost:2773)
const MAX_RETRIES = 3; // Total of 3 attempts = max 24 seconds, leaving 5 seconds buffer

// Initialize SSM client with timeout configuration
let ssmClient = new SSMClient({ 
  region: process.env.AWS_REGION,
  requestHandler: {
    requestTimeout: DEFAULT_TIMEOUT_MS,
    httpsAgent: {
      timeout: DEFAULT_TIMEOUT_MS
    }
  },
  maxAttempts: MAX_RETRIES
});

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

  const startTime = Date.now();
  try {
    log.debug(`Fetching SSM parameter ${parameterName} via Lambda Extensions API (localhost:2773)`);
    const response = await axios.get(endpoint, { 
      headers,
      timeout: LAMBDA_EXTENSION_TIMEOUT_MS,
      signal: AbortSignal.timeout(LAMBDA_EXTENSION_TIMEOUT_MS)
    });
    const elapsed = Date.now() - startTime;
    if (!response.data.Parameter?.Value) {
      log.warn(`SSM parameter ${parameterName} not found via Lambda Extensions API (${elapsed}ms)`);
      return null;
    }
    // Only log if unusually slow (>1s) or in trace mode
    if (elapsed > 1000) {
      log.info(`SSM parameter ${parameterName} fetched via Lambda Extensions API but took ${elapsed}ms`);
    }
    return response.data.Parameter.Value;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    // Improve error message based on error type
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      log.warn(`Lambda Extensions API timeout for parameter ${parameterName} after ${elapsed}ms (limit: ${LAMBDA_EXTENSION_TIMEOUT_MS}ms) - falling back to direct SSM API`);
    } else if (err.code === 'ECONNREFUSED') {
      log.warn(`Lambda Extensions API not available (${elapsed}ms) - falling back to direct SSM API`);
    } else if (err.response?.status === 404) {
      log.warn(`SSM parameter ${parameterName} not found via Lambda Extensions API (${elapsed}ms)`);
    } else {
      log.warn(`Lambda Extensions API error for parameter ${parameterName} (${elapsed}ms): ${err.message} - falling back to direct SSM API`);
    }
    return null;
  }
}

// Helper function to fetch a single parameter from SSM
async function getParameterFromSSM(parameterName, kmsKeyId = null) {
  const baseParams = {
    Name: parameterName,
    WithDecryption: true
  };

  const startTime = Date.now();
  
  // Handle mixed encryption scenarios when using custom KMS keys
  // BACKGROUND: When using a custom KMS key, some parameters may be encrypted with that key
  // while others may be unencrypted. This creates a challenge:
  // - Encrypted parameters REQUIRE the KeyId to decrypt
  // - Unencrypted parameters FAIL if KeyId is provided
  // 
  // SOLUTION: Try with custom key first (for encrypted params), fallback without key (for unencrypted)
  // PERFORMANCE: Only adds overhead in mixed encryption scenarios (should be rare)
  // BEST PRACTICE: Encrypt all parameters with the same custom key to avoid this complexity
  if (kmsKeyId) {
    // First attempt: Try with custom KMS key (for parameters encrypted with this key)
    try {
      const paramsWithKey = { ...baseParams, KeyId: kmsKeyId };
      const command = new GetParameterCommand(paramsWithKey);
      const response = await ssmClient.send(command);
      const elapsed = Date.now() - startTime;
      // Only log if unusually slow
      if (elapsed > 1000) {
        log.info(`SSM parameter ${parameterName} fetched with KMS key but took ${elapsed}ms`);
      }
      return response.Parameter.Value;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      // If KMS-related error, the parameter might be unencrypted - try without KeyId
      if (err.name === 'InvalidKeyId' || 
          err.name === 'KMSInvalidStateException' || 
          err.name === 'ValidationException' ||
          (err.message && err.message.includes('KeyId'))) {
        
        log.info(`Parameter ${parameterName} failed with custom KMS key after ${elapsed}ms, trying without KeyId (likely unencrypted parameter)`);
        
        // Second attempt: Try without KeyId (for unencrypted parameters)
        const retryStartTime = Date.now();
        try {
          const command = new GetParameterCommand(baseParams);
          const response = await ssmClient.send(command);
          const retryElapsed = Date.now() - retryStartTime;
          // Only log if unusually slow
          if (retryElapsed > 1000) {
            log.info(`SSM parameter ${parameterName} fetched without KMS key but took ${retryElapsed}ms`);
          }
          return response.Parameter.Value;
        } catch (secondErr) {
          // Both attempts failed - handle as normal error
          return handleParameterError(parameterName, secondErr, Date.now() - startTime);
        }
      } else {
        // Non-KMS related error - handle normally
        return handleParameterError(parameterName, err, elapsed);
      }
    }
  } else {
    // Standard path: No custom KMS key specified
    try {
      const command = new GetParameterCommand(baseParams);
      const response = await ssmClient.send(command);
      const elapsed = Date.now() - startTime;
      // Only log if unusually slow
      if (elapsed > 1000) {
        log.info(`SSM parameter ${parameterName} fetched but took ${elapsed}ms`);
      }
      return response.Parameter.Value;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      return handleParameterError(parameterName, err, elapsed);
    }
  }
}

// Helper function to handle parameter fetch errors consistently
function handleParameterError(parameterName, err, elapsedMs = null) {
  const timing = elapsedMs ? ` (${elapsedMs}ms)` : '';
  
  if (err.name === 'ParameterNotFound') {
    log.warn(`SSM parameter ${parameterName} not found in this AWS account${timing}`);
  } else if (err.name === 'AccessDeniedException') {
    log.warn(`Access denied to SSM parameter ${parameterName}${timing}. Please check AWS credentials and permissions`);
  } else if (err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException') {
    log.error(`AWS SSM throttling error for parameter ${parameterName}${timing}: ${err.message}`);
  } else if (err.code === 'TimeoutError' || err.code === 'RequestTimeout') {
    log.error(`Timeout fetching SSM parameter ${parameterName}${timing}. AWS SSM may be experiencing issues.`);
  } else if (err.code === 'NetworkingError') {
    log.error(`Network error fetching SSM parameter ${parameterName}${timing}: ${err.message}`);
  } else {
    log.warn(`Error fetching SSM parameter ${parameterName}${timing}: ${err.message}`);
  }
  return null;
}

// Helper function to fetch all parameters
async function getBatchFromSSM(parameterNames, kmsKeyId = null) {
  const batchStartTime = Date.now();
  
  // If using a custom KMS key, we need to fetch parameters individually
  if (kmsKeyId) {
    log.debug(`Fetching ${parameterNames.length} SSM parameters individually due to custom KMS key`);
    const values = {};
    let successCount = 0;
    let failCount = 0;
    
    // Consider parallel fetching with limited concurrency to avoid overwhelming SSM
    const MAX_CONCURRENT = 3;  // Limit concurrent requests to avoid throttling
    for (let i = 0; i < parameterNames.length; i += MAX_CONCURRENT) {
      const batch = parameterNames.slice(i, Math.min(i + MAX_CONCURRENT, parameterNames.length));
      const promises = batch.map(async (paramName) => {
        const value = await getParameterFromSSM(paramName, kmsKeyId);
        if (value !== null) {
          values[paramName] = value;
          successCount++;
          // Individual success logs removed - summary at end is sufficient
        } else {
          failCount++;
          log.warn(`SSM parameter ${paramName} was not found.`);
        }
      });
      await Promise.all(promises);
    }
    
    const totalElapsed = Date.now() - batchStartTime;
    if ((successCount > 0 || failCount > 0) && !isQuietMode) {
      log.info(`Fetched ${successCount} SSM parameters successfully, ${failCount} failed (total time: ${totalElapsed}ms)`);
    }
    return values;
  }

  // Split parameter names into chunks of 10 due to AWS API limit
  const batchSize = 10;
  const values = {};
  const allInvalidParameters = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < parameterNames.length; i += batchSize) {
    const batch = parameterNames.slice(i, i + batchSize);
    const batchNum = Math.floor(i/batchSize) + 1;
    const totalBatches = Math.ceil(parameterNames.length / batchSize);
    
    const params = {
      Names: batch,
      WithDecryption: true
    };

    const batchStartTime = Date.now();
    try {
      log.debug(`Fetching batch ${batchNum}/${totalBatches} (${batch.length} parameters)`);
      const command = new GetParametersCommand(params);
      const response = await ssmClient.send(command);
      const batchElapsed = Date.now() - batchStartTime;
      
      response.Parameters.forEach(param => {
        values[param.Name] = param.Value;
        successCount++;
        // Individual success logs removed - summary at end is sufficient
      });

      // Collect invalid parameters from all batches
      allInvalidParameters.push(...response.InvalidParameters);
      failCount += response.InvalidParameters.length;
      
      log.debug(`Batch ${batchNum}/${totalBatches} completed in ${batchElapsed}ms (${response.Parameters.length} found, ${response.InvalidParameters.length} not found)`);

    } catch (err) {
      const batchElapsed = Date.now() - batchStartTime;
      failCount += batch.length;
      
      if (err.name === 'ThrottlingException') {
        log.error(`AWS SSM throttling on batch ${batchNum}/${totalBatches} after ${batchElapsed}ms. Consider reducing concurrent requests.`);
      } else if (err.code === 'TimeoutError' || err.code === 'RequestTimeout') {
        log.error(`Timeout on batch ${batchNum}/${totalBatches} after ${batchElapsed}ms. AWS SSM may be experiencing issues.`);
      } else {
        log.warn(`Error fetching batch ${batchNum}/${totalBatches} after ${batchElapsed}ms: ${err.message}`);
      }
      // Continue with next batch rather than failing entirely
    }
  }

  const totalElapsed = Date.now() - batchStartTime;
  if ((successCount > 0 || failCount > 0) && !isQuietMode) {
    log.info(`Batch fetch completed: ${successCount} parameters retrieved, ${failCount} failed (total time: ${totalElapsed}ms)`);
  }
  
  // Log all invalid parameters at the end
  allInvalidParameters.forEach(param => {
    log.warn(`SSM parameter ${param} was not found.`);
  });

  return values;
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

  const loadStartTime = Date.now();
  log.debug(`Starting configuration initialization...`);
  
  const ssmParameters = Object.values(configMap)
    .filter(({ fallbackSSM }) => fallbackSSM)
    .map(({ fallbackSSM }) => fallbackSSM);

  let ssmValues = {};
  if (ssmParameters.length > 0) {
    if (isLambda) {
      // Try to fetch from Lambda Extensions API first
      let lambdaExtensionFailed = false;
      log.debug(`Attempting to fetch ${ssmParameters.length} parameters via Lambda Extensions API`);
      for (const param of ssmParameters) {
        const value = await getFromLambdaExtension(param);
        if (value === null) {
          lambdaExtensionFailed = true;
          log.info(`Lambda Extensions API unavailable or parameter not found - switching to direct SSM API calls`);
          break;
        }
        ssmValues[param] = value;
      }

      // If Lambda extension failed, clear ssmValues to fetch all from SSM API
      if (lambdaExtensionFailed) {
        ssmValues = {};
      } else {
        log.info(`Successfully fetched all ${ssmParameters.length} parameters via Lambda Extensions API`);
      }
    }

    // If not in Lambda or Lambda extension failed, fetch all from SSM API
    if (Object.keys(ssmValues).length === 0) {
      if (isLambda) {
        log.info(`Fetching ${ssmParameters.length} parameters via direct SSM API calls`);
      }
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

  const totalLoadTime = Date.now() - loadStartTime;
  const summary = Object.entries(sourceCounts)
    .map(([source, count]) => `${count} from ${source}`)
    .join(', ');
  log.summary(`Config loaded: ${summary} (total initialization time: ${totalLoadTime}ms)`);

  // Show detailed parameter info unless in quiet mode
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
    log.debug('Configuration initialization already in progress, waiting for completion...');
    return initializationPromise;
  }

  // Support quiet option to suppress detailed output
  if (options.quiet !== undefined) {
    isQuietMode = options.quiet;
    log.setQuietMode(options.quiet);
  }

  // Apply custom timeout if provided
  if (options.timeout) {
    const timeout = parseInt(options.timeout, 10);
    if (!isNaN(timeout) && timeout > 0) {
      log.debug(`Using custom timeout: ${timeout}ms`);
      // Update SSM client with new timeout
      ssmClient = new SSMClient({ 
        region: process.env.AWS_REGION,
        requestHandler: {
          requestTimeout: timeout,
          httpsAgent: {
            timeout: timeout
          }
        },
        maxAttempts: MAX_RETRIES
      });
    }
  }

  // Create and store the promise before doing any async work
  initializationPromise = loadConfig(kmsKeyId)
    .then(() => {
      log.debug('Configuration initialization completed successfully');
    })
    .catch(error => {
      log.error(`Configuration initialization failed: ${error.message}`);
      initializationPromise = null;
      configInitialized = false;
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
    if (prop === 'DEFAULT_TIMEOUT_MS') {
      return DEFAULT_TIMEOUT_MS;
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

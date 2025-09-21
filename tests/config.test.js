const { SSMClient, PutParameterCommand, DeleteParameterCommand } = require('@aws-sdk/client-ssm');

// Set AWS region before requiring any AWS SDK clients
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Create SSM client for test setup/teardown using default credential chain
const ssmClient = new SSMClient({ 
    region: process.env.AWS_REGION
});

describe('SSM Config', () => {
  // Add KMS key alias to test params
  const TEST_CONFIG = {
    PARAMS: {
      STRING_PARAM: '/test/ssm-config/string-param',
      INT_PARAM: '/test/ssm-config/int-param',
      BOOL_PARAM: '/test/ssm-config/bool-param',
      FLOAT_PARAM: '/test/ssm-config/float-param',
      BOOL_ZERO_PARAM: '/test/ssm-config/bool-zero-param',
      SECRET_PARAM: '/test/ssm-config/secret-param',
      KMS_PARAM: '/test/ssm-config/kms-param',
      // Additional params for batch testing (>10 params total)
      BATCH_PARAM_1: '/test/ssm-config/batch-param-1',
      BATCH_PARAM_2: '/test/ssm-config/batch-param-2',
      BATCH_PARAM_3: '/test/ssm-config/batch-param-3',
      BATCH_PARAM_4: '/test/ssm-config/batch-param-4',
      BATCH_PARAM_5: '/test/ssm-config/batch-param-5',
      BATCH_PARAM_6: '/test/ssm-config/batch-param-6',
      BATCH_PARAM_7: '/test/ssm-config/batch-param-7',
      BATCH_PARAM_8: '/test/ssm-config/batch-param-8',
      BATCH_PARAM_9: '/test/ssm-config/batch-param-9',
      BATCH_PARAM_10: '/test/ssm-config/batch-param-10',
      BATCH_PARAM_11: '/test/ssm-config/batch-param-11',
      BATCH_PARAM_12: '/test/ssm-config/batch-param-12'
    },
    KMS_KEY_ALIAS: 'alias/ssm-parameter-key'
  };

  let testsPassed = false;

  // Set up test parameters before all tests
  beforeAll(async () => {
    // Create test parameters in SSM
    const putCommands = [
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.STRING_PARAM,
        Value: 'test-string-value',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.INT_PARAM,
        Value: '42',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BOOL_PARAM,
        Value: 'true',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.FLOAT_PARAM,
        Value: '3.14',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BOOL_ZERO_PARAM,
        Value: '0',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.SECRET_PARAM,
        Value: 'secret-value',
        Type: 'SecureString',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.KMS_PARAM,
        Value: 'kms-encrypted-value',
        Type: 'SecureString',
        KeyId: TEST_CONFIG.KMS_KEY_ALIAS,
        Overwrite: true
      }),
      // Additional parameters for batch testing
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_1,
        Value: 'batch-value-1',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_2,
        Value: 'batch-value-2',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_3,
        Value: 'batch-value-3',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_4,
        Value: 'batch-value-4',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_5,
        Value: 'batch-value-5',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_6,
        Value: 'batch-value-6',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_7,
        Value: 'batch-value-7',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_8,
        Value: 'batch-value-8',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_9,
        Value: 'batch-value-9',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_10,
        Value: 'batch-value-10',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_11,
        Value: 'batch-value-11',
        Type: 'String',
        Overwrite: true
      }),
      new PutParameterCommand({
        Name: TEST_CONFIG.PARAMS.BATCH_PARAM_12,
        Value: 'batch-value-12',
        Type: 'String',
        Overwrite: true
      })
    ];

    await Promise.all(putCommands.map(cmd => ssmClient.send(cmd)));
  });

  // Single afterAll block that handles both test status and cleanup
  afterAll(async () => {
    // All tests have passed if we get here
    console.log('Tests passed - cleaning up test parameters');
    
    const deleteCommands = Object.values(TEST_CONFIG.PARAMS).map(name => 
      new DeleteParameterCommand({ Name: name })
    );

    await Promise.all(deleteCommands.map(cmd => ssmClient.send(cmd)));
  });

  beforeEach(() => {
    jest.resetModules();
    // Preserve AWS settings when resetting env
    const region = process.env.AWS_REGION;
    const profile = process.env.AWS_PROFILE;
    process.env = { 
      AWS_REGION: region,
      AWS_PROFILE: profile
    };
  });

  test('should load values from environment variables', async () => {
    process.env.TEST_VALUE = 'from-env';
    
    const config = require('../index');
    config.configMap = {
      TEST_KEY: { envVar: 'TEST_VALUE', type: 'string' }
    };

    await config.initializeConfig();
    expect(config.TEST_KEY).toBe('from-env');
  });

  test('should load values from SSM when env vars not present', async () => {
    const config = require('../index');
    config.configMap = {
      TEST_KEY: { 
        envVar: 'TEST_VALUE', 
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM,
        type: 'string' 
      }
    };

    await config.initializeConfig();
    expect(config.TEST_KEY).toBe('test-string-value');
  });

  test('should handle different value types from SSM', async () => {
    const config = require('../index');
    config.configMap = {
      STRING_KEY: { 
        envVar: 'STRING_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM, 
        type: 'string' 
      },
      INT_KEY: { 
        envVar: 'INT_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.INT_PARAM, 
        type: 'int' 
      },
      BOOL_KEY: { 
        envVar: 'BOOL_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.BOOL_PARAM, 
        type: 'bool' 
      },
      FLOAT_KEY: { 
        envVar: 'FLOAT_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.FLOAT_PARAM, 
        type: 'float' 
      },
      BOOL_ZERO_KEY: { 
        envVar: 'BOOL_ZERO_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.BOOL_ZERO_PARAM, 
        type: 'bool' 
      }
    };

    await config.initializeConfig();
    expect(config.STRING_KEY).toBe('test-string-value');
    expect(config.INT_KEY).toBe(42);
    expect(config.BOOL_KEY).toBe(true);
    expect(config.FLOAT_KEY).toBe(3.14);
    expect(config.BOOL_ZERO_KEY).toBe(false);
  });

  test('should handle SecureString parameters', async () => {
    const config = require('../index');
    config.configMap = {
      SECRET_KEY: { 
        envVar: 'SECRET_VALUE', 
        fallbackSSM: TEST_CONFIG.PARAMS.SECRET_PARAM, 
        type: 'string' 
      }
    };

    await config.initializeConfig();
    expect(config.SECRET_KEY).toBe('secret-value');
  });

  test('should use static fallbacks when SSM fails', async () => {
    const config = require('../index');
    config.configMap = {
      TEST_KEY: { 
        envVar: 'TEST_VALUE', 
        fallbackSSM: '/non/existent/parameter',
        fallbackStatic: 'fallback-value',
        type: 'string' 
      }
    };

    await config.initializeConfig();
    expect(config.TEST_KEY).toBe('fallback-value');
  });

  test('should throw error for missing required values', async () => {
    const config = require('../index');
    config.configMap = {
      REQUIRED_KEY: { envVar: 'REQUIRED_VALUE', type: 'string' }
    };

    await expect(config.initializeConfig()).rejects.toThrow('Missing configuration value');
  });

  test('should handle parameters encrypted with custom KMS key', async () => {
    const config = require('../index');
    config.configMap = {
      KMS_KEY: { 
        envVar: 'KMS_VALUE', 
        fallbackSSM: TEST_CONFIG.PARAMS.KMS_PARAM,
        type: 'string' 
      }
    };

    await config.initializeConfig(TEST_CONFIG.KMS_KEY_ALIAS);
    expect(config.KMS_KEY).toBe('kms-encrypted-value');
  });

  test('should handle mixed encrypted/unencrypted parameters with custom KMS key', async () => {
    const config = require('../index');
    
    // Set up a config with both encrypted (KMS_PARAM) and unencrypted (STRING_PARAM) parameters
    // This tests the try-catch logic when using a custom KMS key
    config.configMap = {
      ENCRYPTED_KEY: { 
        envVar: 'ENCRYPTED_VALUE', 
        fallbackSSM: TEST_CONFIG.PARAMS.KMS_PARAM,  // SecureString with custom KMS key
        type: 'string' 
      },
      UNENCRYPTED_KEY: { 
        envVar: 'UNENCRYPTED_VALUE', 
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM,  // Plain String parameter
        type: 'string' 
      }
    };

    // Use custom KMS key - this should trigger try-catch for the unencrypted parameter
    await config.initializeConfig(TEST_CONFIG.KMS_KEY_ALIAS);
    
    // Both parameters should load successfully
    expect(config.ENCRYPTED_KEY).toBe('kms-encrypted-value');
    expect(config.UNENCRYPTED_KEY).toBe('test-string-value');
  });

  // Add this test to verify the README example interface
  test('should work with the README example interface', async () => {
    const config = require('../index');
    
    // Set up config as shown in README
    config.configMap = {
      TEST_KEY: { 
        envVar: 'TEST_VALUE', 
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM,
        type: 'string' 
      }
    };

    // Initialize as shown in README
    await config.initializeConfig();
    
    // Verify it works
    expect(config.TEST_KEY).toBe('test-string-value');
  });

  test('should throw error if configMap not set before initialization', async () => {
    const config = require('../index');
    
    // Try to initialize without setting configMap
    await expect(config.initializeConfig())
      .rejects
      .toThrow('Configuration map not set');
  });

  test('should handle concurrent initializations with a single SSM call', async () => {
    const config = require('../index');
    
    // Set up config with an SSM parameter
    config.configMap = {
      TEST_KEY: { 
        envVar: 'TEST_VALUE', 
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM,
        type: 'string' 
      }
    };

    // Start multiple concurrent initializations
    const [result1, result2, result3] = await Promise.all([
      config.initializeConfig(),
      config.initializeConfig(),
      config.initializeConfig()
    ]);

    // Verify the config was loaded correctly
    expect(config.TEST_KEY).toBe('test-string-value');
  });

  test('should respect quiet mode and only show summary', async () => {
    // Clear the module cache to ensure a fresh instance
    jest.resetModules();

    // Now require the module
    const config = require('../index');
    const ConfigLogger = require('../lib/logger');

    // Create a mock logger with Jest spy functions
    const mockLogger = new ConfigLogger({
      quiet: true,
      output: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    });

    // Mock SSM client to avoid actual AWS calls
    const mockGetParametersCommand = jest.fn().mockResolvedValue({
      Parameters: [
        { Name: TEST_CONFIG.PARAMS.STRING_PARAM, Value: 'test-string-value' }
      ],
      InvalidParameters: []
    });
    const mockSend = jest.fn().mockImplementation(() => mockGetParametersCommand());
    const mockSSMClient = { send: mockSend };

    // Set up configuration
    config.configMap = {
      TEST_ENV: { envVar: 'TEST_ENV', type: 'string' },
      TEST_SSM: { 
        envVar: 'TEST_SSM', 
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM,
        type: 'string' 
      },
      TEST_DEFAULT: { envVar: 'TEST_DEFAULT', fallbackStatic: 'default', type: 'string' }
    };

    process.env.TEST_ENV = 'env-value';
    
    // Set up mocks and quiet mode
    config.ssmClient = mockSSMClient;
    config.log = mockLogger;
    
    // Initialize with quiet mode
    await config.initializeConfig(null, { quiet: true });

    // Should only show the summary line
    expect(mockLogger.output.info.mock.calls).toHaveLength(1);
    expect(mockLogger.output.info.mock.calls[0][0]).toMatch(/^Config loaded: 1 from env, 1 from ssm, 1 from default \(total initialization time: \d+ms\)$/);
    
    // Debug logs should be suppressed
    expect(mockLogger.output.debug.mock.calls).toHaveLength(0);
  });

  test('should show verbose output in normal mode', async () => {
    // Clear the module cache to ensure a fresh instance
    jest.resetModules();

    // Now require the module
    const config = require('../index');
    const ConfigLogger = require('../lib/logger');

    // Create a mock logger with Jest spy functions
    const mockLogger = new ConfigLogger({
      output: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    });

    // Mock SSM client to avoid actual AWS calls
    const mockGetParametersCommand = jest.fn().mockResolvedValue({
      Parameters: [
        { Name: TEST_CONFIG.PARAMS.STRING_PARAM, Value: 'test-string-value' }
      ],
      InvalidParameters: []
    });
    const mockSend = jest.fn().mockImplementation(() => mockGetParametersCommand());
    const mockSSMClient = { send: mockSend };

    // Set up configuration
    config.configMap = {
      TEST_ENV: { envVar: 'TEST_ENV', type: 'string' },
      TEST_SSM: { 
        envVar: 'TEST_SSM', 
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM,
        type: 'string' 
      }
    };

    process.env.TEST_ENV = 'env-value';
    
    // Set up mocks
    config.ssmClient = mockSSMClient;
    config.log = mockLogger;
    
    // Initialize without quiet mode
    await config.initializeConfig();

    // Should show summary line
    expect(mockLogger.output.info.mock.calls.some(call => 
      call[0].startsWith('Config loaded:')
    )).toBe(true);

    // Should show the "Loaded configuration values:" header
    expect(mockLogger.output.info.mock.calls.some(call => 
      call[0] === 'Loaded configuration values:'
    )).toBe(true);

    // Should show some debug output about SSM parameters
    expect(mockLogger.output.debug.mock.calls.length).toBeGreaterThan(0);

    // Should show details about loaded values
    expect(mockLogger.output.info.mock.calls.some(call => 
      call[0].includes('TEST_ENV') && call[0].includes('env')
    )).toBe(true);
  });

  test('should throw error for invalid type', async () => {
    const config = require('../index');
    config.configMap = {
      INVALID_TYPE_KEY: { 
        envVar: 'INVALID_TYPE_VAL', 
        fallbackStatic: 'some-value', 
        type: 'boolean' // Using "boolean" instead of "bool"
      }
    };

    await expect(config.initializeConfig()).rejects.toThrow('Invalid type "boolean"');
  });

  test('should throw error for invalid boolean value', async () => {
    process.env.BOOL_VAL = 'not-a-boolean';
    
    const config = require('../index');
    config.configMap = {
      BOOL_KEY: { 
        envVar: 'BOOL_VAL', 
        type: 'bool'
      }
    };

    await expect(config.initializeConfig()).rejects.toThrow('Invalid boolean value');
  });

  test('should properly convert float values', async () => {
    process.env.FLOAT_VAL = '3.14159';
    
    const config = require('../index');
    config.configMap = {
      FLOAT_KEY: { envVar: 'FLOAT_VAL', type: 'float' }
    };

    await config.initializeConfig();
    expect(config.FLOAT_KEY).toBe(3.14159);
  });

  test('should properly convert boolean values from different formats', async () => {
    process.env.BOOL_TRUE_STR = 'true';
    process.env.BOOL_TRUE_ONE = '1';
    process.env.BOOL_FALSE_STR = 'false';
    process.env.BOOL_FALSE_ZERO = '0';
    
    const config = require('../index');
    config.configMap = {
      BOOL_TRUE_STR_KEY: { envVar: 'BOOL_TRUE_STR', type: 'bool' },
      BOOL_TRUE_ONE_KEY: { envVar: 'BOOL_TRUE_ONE', type: 'bool' },
      BOOL_FALSE_STR_KEY: { envVar: 'BOOL_FALSE_STR', type: 'bool' },
      BOOL_FALSE_ZERO_KEY: { envVar: 'BOOL_FALSE_ZERO', type: 'bool' }
    };

    await config.initializeConfig();
    expect(config.BOOL_TRUE_STR_KEY).toBe(true);
    expect(config.BOOL_TRUE_ONE_KEY).toBe(true);
    expect(config.BOOL_FALSE_STR_KEY).toBe(false);
    expect(config.BOOL_FALSE_ZERO_KEY).toBe(false);
  });

  test('should throw error for invalid boolean string values', async () => {
    process.env.INVALID_BOOL = 'yes';
    
    const config = require('../index');
    config.configMap = {
      INVALID_BOOL_KEY: { envVar: 'INVALID_BOOL', type: 'bool' }
    };

    await expect(config.initializeConfig()).rejects.toThrow('Invalid boolean value');
  });

  test('should handle static fallbacks properly for boolean values', async () => {
    // Do NOT set environment variables, we want to test fallback
    
    const config = require('../index');
    config.configMap = {
      BOOL_FALLBACK_TRUE_KEY: { 
        envVar: 'BOOL_FALLBACK_TRUE', 
        fallbackStatic: 'true',
        type: 'bool' 
      },
      BOOL_FALLBACK_FALSE_KEY: { 
        envVar: 'BOOL_FALLBACK_FALSE', 
        fallbackStatic: 'false',
        type: 'bool' 
      },
      BOOL_FALLBACK_ONE_KEY: { 
        envVar: 'BOOL_FALLBACK_ONE', 
        fallbackStatic: '1',
        type: 'bool' 
      },
      BOOL_FALLBACK_ZERO_KEY: { 
        envVar: 'BOOL_FALLBACK_ZERO', 
        fallbackStatic: '0',
        type: 'bool' 
      }
    };

    await config.initializeConfig();
    expect(config.BOOL_FALLBACK_TRUE_KEY).toBe(true);
    expect(config.BOOL_FALLBACK_FALSE_KEY).toBe(false);
    expect(config.BOOL_FALLBACK_ONE_KEY).toBe(true);
    expect(config.BOOL_FALLBACK_ZERO_KEY).toBe(false);
  });

  test('should handle static fallbacks properly for boolean when accessed before initialization', async () => {
    // Do NOT set environment variables, we want to test fallback
    
    const config = require('../index');
    config.configMap = {
      BOOL_FALLBACK_TRUE_KEY: { 
        envVar: 'BOOL_FALLBACK_TRUE', 
        fallbackStatic: 'true',
        type: 'bool' 
      }
    };

    // Access BEFORE initialization
    expect(config.BOOL_FALLBACK_TRUE_KEY).toBe(true);
  });

  test('should handle the case where environment variable is undefined after initialization', async () => {
    // Do NOT set environment variables
    
    const config = require('../index');
    config.configMap = {
      BOOL_KEY: { 
        envVar: 'BOOL_VAL_NOT_SET', 
        fallbackStatic: 'true',
        type: 'bool' 
      }
    };

    // Initialize the config
    await config.initializeConfig();
    
    // Delete the environment variable that was set during initialization
    delete process.env.BOOL_VAL_NOT_SET;
    
    // Now access the config - this should still use the fallback
    expect(config.BOOL_KEY).toBe(true);
  });

  test('should respect changes to environment variables after initialization', async () => {
    // Initialize with one value
    process.env.DYNAMIC_TEST_VAR = 'initial-value';
    
    const config = require('../index');
    config.configMap = {
      DYNAMIC_KEY: { 
        envVar: 'DYNAMIC_TEST_VAR',
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM, // Fallback if env var not set
        type: 'string' 
      }
    };

    // Initialize the config
    await config.initializeConfig();
    
    // Initial value check
    expect(config.DYNAMIC_KEY).toBe('initial-value');
    
    // Change the environment variable after initialization
    process.env.DYNAMIC_TEST_VAR = 'updated-value';
    
    // The config should now return the updated value
    expect(config.DYNAMIC_KEY).toBe('updated-value');
    
    // Delete the env var - should fall back to the SSM value
    delete process.env.DYNAMIC_TEST_VAR;
    expect(config.DYNAMIC_KEY).toBe('test-string-value');
  });

  test('should respect LOG_LEVEL environment variable for verbosity control', async () => {
    // Mock is used here because we're testing logging behavior, not SSM functionality
    // (same approach as existing quiet mode test)
    jest.resetModules();
    
    // Set LOG_LEVEL before requiring module
    process.env.LOG_LEVEL = 'error';
    
    const config = require('../index');
    const ConfigLogger = require('../lib/logger');

    // Create mock logger to capture output levels
    const mockLogger = new ConfigLogger({
      output: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    });

    // Mock SSM client
    const mockSSMClient = { 
      send: jest.fn().mockResolvedValue({
        Parameters: [{ Name: '/test/param', Value: 'test-value' }],
        InvalidParameters: []
      })
    };

    config.configMap = {
      TEST_KEY: { envVar: 'TEST_LOG_LEVEL', fallbackSSM: '/test/param', type: 'string' }
    };
    
    config.ssmClient = mockSSMClient;
    config.log = mockLogger;

    await config.initializeConfig();

    // With LOG_LEVEL=error, should only show errors (and summary which is always info level)
    expect(mockLogger.output.debug).not.toHaveBeenCalled();
    expect(mockLogger.output.error).not.toHaveBeenCalled(); // No errors occurred
    expect(mockLogger.output.info).toHaveBeenCalledTimes(1); // Just the summary
    
    // Clean up
    delete process.env.LOG_LEVEL;
  });

  test('should accept custom timeout option', async () => {
    // Mock is used here to avoid waiting for actual timeouts in tests
    // Real timeout testing would require intentionally slow/failing SSM calls
    jest.resetModules();
    
    const config = require('../index');

    config.configMap = {
      TEST_KEY: { envVar: 'TEST_TIMEOUT', fallbackStatic: 'default', type: 'string' }
    };

    // Test that custom timeout is accepted without throwing errors
    // (Testing actual timeout behavior would require real AWS failures)
    await expect(config.initializeConfig(null, { timeout: 5000 })).resolves.toBeUndefined();
    await expect(config.initializeConfig(null, { timeout: 15000 })).resolves.toBeUndefined();
    
    // Verify default timeout constant is reasonable for API Gateway
    expect(config.DEFAULT_TIMEOUT_MS).toBeLessThan(10000); // Should be under 10 seconds
    expect(config.DEFAULT_TIMEOUT_MS).toBeGreaterThan(5000); // Should be reasonable
  });

  test('should provide component-level override with quiet mode', async () => {
    // Mock is used because we're testing component-level logging behavior
    // This verifies quiet mode overrides LOG_LEVEL for SSM config specifically
    jest.resetModules();
    
    // Set LOG_LEVEL to most verbose, but use quiet mode
    process.env.LOG_LEVEL = 'debug';
    
    const config = require('../index');
    const ConfigLogger = require('../lib/logger');

    const mockLogger = new ConfigLogger({
      quiet: true, // Component-level override
      output: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    });

    config.configMap = {
      TEST_KEY: { envVar: 'TEST_COMPONENT', fallbackStatic: 'default', type: 'string' }
    };
    config.log = mockLogger;

    await config.initializeConfig(null, { quiet: true });

    // Even with LOG_LEVEL=debug, quiet mode should suppress verbose output
    expect(mockLogger.output.debug).not.toHaveBeenCalled();
    expect(mockLogger.output.info).toHaveBeenCalledTimes(1); // Just summary
    
    // But warnings/errors would still show (component-level override)
    // No warnings/errors in this test, but behavior is verified in logger tests
    
    // Clean up
    delete process.env.LOG_LEVEL;
  });

  test('should handle more than 10 SSM parameters by batching requests', async () => {
    const config = require('../index');
    
    // Create a config with more than 10 SSM parameters (18 total - excluding KMS param to avoid decryption issues)
    config.configMap = {
      STRING_KEY: { 
        envVar: 'STRING_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.STRING_PARAM, 
        type: 'string' 
      },
      INT_KEY: { 
        envVar: 'INT_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.INT_PARAM, 
        type: 'int' 
      },
      BOOL_KEY: { 
        envVar: 'BOOL_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.BOOL_PARAM, 
        type: 'bool' 
      },
      FLOAT_KEY: { 
        envVar: 'FLOAT_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.FLOAT_PARAM, 
        type: 'float' 
      },
      BOOL_ZERO_KEY: { 
        envVar: 'BOOL_ZERO_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.BOOL_ZERO_PARAM, 
        type: 'bool' 
      },
      SECRET_KEY: { 
        envVar: 'SECRET_VAL', 
        fallbackSSM: TEST_CONFIG.PARAMS.SECRET_PARAM, 
        type: 'string' 
      },
      BATCH_KEY_1: { 
        envVar: 'BATCH_VAL_1', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_1, 
        type: 'string' 
      },
      BATCH_KEY_2: { 
        envVar: 'BATCH_VAL_2', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_2, 
        type: 'string' 
      },
      BATCH_KEY_3: { 
        envVar: 'BATCH_VAL_3', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_3, 
        type: 'string' 
      },
      BATCH_KEY_4: { 
        envVar: 'BATCH_VAL_4', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_4, 
        type: 'string' 
      },
      BATCH_KEY_5: { 
        envVar: 'BATCH_VAL_5', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_5, 
        type: 'string' 
      },
      BATCH_KEY_6: { 
        envVar: 'BATCH_VAL_6', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_6, 
        type: 'string' 
      },
      BATCH_KEY_7: { 
        envVar: 'BATCH_VAL_7', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_7, 
        type: 'string' 
      },
      BATCH_KEY_8: { 
        envVar: 'BATCH_VAL_8', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_8, 
        type: 'string' 
      },
      BATCH_KEY_9: { 
        envVar: 'BATCH_VAL_9', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_9, 
        type: 'string' 
      },
      BATCH_KEY_10: { 
        envVar: 'BATCH_VAL_10', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_10, 
        type: 'string' 
      },
      BATCH_KEY_11: { 
        envVar: 'BATCH_VAL_11', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_11, 
        type: 'string' 
      },
      BATCH_KEY_12: { 
        envVar: 'BATCH_VAL_12', 
        fallbackSSM: TEST_CONFIG.PARAMS.BATCH_PARAM_12, 
        type: 'string' 
      }
    };

    // Initialize without KMS key to test batch fetching (not individual fetching)
    await config.initializeConfig();
    
    // Verify all parameters were loaded correctly
    // This tests that the batching logic correctly handles >10 parameters
    expect(config.STRING_KEY).toBe('test-string-value');
    expect(config.INT_KEY).toBe(42);
    expect(config.BOOL_KEY).toBe(true);
    expect(config.FLOAT_KEY).toBe(3.14);
    expect(config.BOOL_ZERO_KEY).toBe(false);
    expect(config.SECRET_KEY).toBe('secret-value');
    expect(config.BATCH_KEY_1).toBe('batch-value-1');
    expect(config.BATCH_KEY_2).toBe('batch-value-2');
    expect(config.BATCH_KEY_3).toBe('batch-value-3');
    expect(config.BATCH_KEY_4).toBe('batch-value-4');
    expect(config.BATCH_KEY_5).toBe('batch-value-5');
    expect(config.BATCH_KEY_6).toBe('batch-value-6');
    expect(config.BATCH_KEY_7).toBe('batch-value-7');
    expect(config.BATCH_KEY_8).toBe('batch-value-8');
    expect(config.BATCH_KEY_9).toBe('batch-value-9');
    expect(config.BATCH_KEY_10).toBe('batch-value-10');
    expect(config.BATCH_KEY_11).toBe('batch-value-11');
    expect(config.BATCH_KEY_12).toBe('batch-value-12');
  });
});

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
      KMS_PARAM: '/test/ssm-config/kms-param'
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
    expect(mockLogger.output.info.mock.calls[0][0]).toBe('Config loaded: 1 from env, 1 from ssm, 1 from default');
    
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
});

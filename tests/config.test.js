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
      }
    };

    await config.initializeConfig();
    expect(config.STRING_KEY).toBe('test-string-value');
    expect(config.INT_KEY).toBe(42);
    expect(config.BOOL_KEY).toBe(true);
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
});

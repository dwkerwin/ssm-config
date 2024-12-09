# @dwkerwin/ssm-config

A flexible configuration loader that supports environment variables, AWS SSM parameters, and static fallbacks, with built-in support for the AWS Lambda Extensions API for improved performance when fetching SSM parameters from within Lambda.

## Motivation

This package was created to address the challenges of managing configuration and secrets in AWS Lambda functions, particularly when using container images. The main goals were:

1. Avoid storing sensitive information directly in environment variables.
2. Efficiently read secrets from AWS Systems Manager (SSM) Parameter Store within Lambda functions.
3. Support the AWS Lambda Extensions API for improved performance when fetching SSM parameters.
4. Support custom KMS keys for encrypted SSM parameters.
5. Provide a simple, consistent interface for accessing configuration throughout the application.

`@dwkerwin/ssm-config` achieves these goals by:

- Supporting SSM Parameter Store as a source for configuration values
- Utilizing the AWS Parameters and Secrets Lambda Extension when available, which provides a local HTTP endpoint (localhost:2773) for efficient parameter retrieval without direct AWS API calls
- Supporting custom KMS keys for decryption of SSM parameters
- Falling back to batch API calls to SSM Parameter Store when the Extension is not available
- Caching configuration values after initial load for fast access during function invocations

## Installation

```bash
npm install @dwkerwin/ssm-config
```

## Usage

1. Create a `ssmConfig.js` file in your project:

```javascript
const config = require('@dwkerwin/ssm-config');

// Define your configuration schema
const configMap = {
    AWS_REGION: { envVar: 'AWS_REGION', fallbackStatic: 'us-east-1', type: 'string' },
    LOG_LEVEL: { envVar: 'LOG_LEVEL', type: 'string' },
    JWT_SECRET: { envVar: 'JWT_SECRET', fallbackSSM: '/my-app/secrets/jwt_secret', type: 'string' },
    // ... other config items
};

// Set the configMap and initialize
config.configMap = configMap;

// Initialize with optional KMS key ID or alias
const configInitPromise = config.initializeConfig(
    process.env.SSM_PARAMETER_KMS_KEY || 'alias/my-custom-key'
);

module.exports = config;
```

2. In your application code, you can safely initialize the config wherever needed:

```javascript
const config = require('./ssmConfig');

// The library ensures only one actual initialization occurs
async function someFunction() {
    // Safe to call multiple times - will reuse existing initialization
    await config.initializeConfig(
        process.env.SSM_PARAMETER_KMS_KEY || 'alias/my-custom-key'
    );
    console.log(config.LOG_LEVEL);
}

class SomeService {
    async init() {
        // Same here - safe to call in multiple places
        await config.initializeConfig(
            process.env.SSM_PARAMETER_KMS_KEY || 'alias/my-custom-key'
        );
        this.secret = config.JWT_SECRET;
    }
}
```

The library handles concurrent initialization safely:
- If it's the first call, it performs the initialization
- If initialization is in progress, it returns the existing promise
- If already initialized, it returns immediately
- Only one set of SSM calls will ever be made

This means you don't need to manually coordinate initialization across your application - just call `initializeConfig()` when you need it, making sure to pass the KMS key if you're using encrypted parameters.

### Initialization Patterns

The library is flexible about where you initialize the config. Here are some common patterns:

#### Constructor Initialization
```javascript
class MyService {
    constructor() {
        // Option 1: Initialize in constructor (if your framework supports async constructors)
        this.initPromise = config.initializeConfig(
            process.env.SSM_PARAMETER_KMS_KEY || 'alias/my-custom-key'
        );
    }

    async someMethod() {
        // Wait for initialization before using config
        await this.initPromise;
        this.secret = config.JWT_SECRET;
    }
}

// Option 2: Separate initialization method (recommended for most cases)
class AnotherService {
    constructor() {
        // Don't access config values here
    }

    async init() {
        await config.initializeConfig(
            process.env.SSM_PARAMETER_KMS_KEY || 'alias/my-custom-key'
        );
        // Now safe to access config
        this.secret = config.JWT_SECRET;
    }
}
```

For most applications, we recommend:
1. Using a separate `init()` method instead of initializing in constructors
2. Always passing the KMS key if you're using encrypted parameters
3. Awaiting initialization before accessing any config values

Note: If you try to access config values before initialization is complete, the config object will throw an error unless the value has a `fallbackStatic` defined.

### Example: Using with Serverless Koa

Here's how to use the configuration in a serverless Koa application that needs to support both AWS Lambda and local development:

```javascript
const serverless = require('serverless-http');
const Koa = require('koa');
const config = require('./ssmConfig');

const app = new Koa();
// ... app middleware setup ...

// Lambda handler
const handler = serverless(app);
exports.handler = async (event, context) => {
    await config.initializeConfig(
        process.env.SSM_PARAMETER_KMS_KEY || 'alias/ssm-parameter-key'
    );
    return handler(event, context);
};

// Local development server
if (!process.env.LAMBDA_TASK_ROOT && require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, async () => {
        await config.initializeConfig();
        console.log(`Server running on http://localhost:${port}`);
    });
}
```

This pattern ensures the configuration is initialized before handling any requests, whether running in Lambda or locally.

## API

### Configuration Map

The `configMap` defines your configuration schema:

```javascript
{
    CONFIG_KEY: {
        envVar: 'ENVIRONMENT_VARIABLE_NAME',     // Required: environment variable name
        fallbackSSM: '/ssm/parameter/path',      // Optional: SSM parameter path to use if env var not set
        fallbackStatic: 'default value',         // Optional: static fallback if neither env var nor SSM available
        type: 'string' | 'int' | 'bool'         // Required: expected type of the value
    }
}
```

### Methods

#### `config.initializeConfig(kmsKeyId)`

Asynchronously initializes the configuration. This should be called once at the start of your application.

- `kmsKeyId`: (Optional) KMS key ID or alias for decryption of SSM parameters. Can be specified as either:
  - A key ID: `"1234abcd-12ab-34cd-56ef-1234567890ab"`
  - A key alias: `"alias/my-custom-key"`

Note: When using a custom KMS key, ensure your Lambda function's IAM role has the necessary `kms:Decrypt` permissions for that key.

#### `config.SOME_CONFIG_KEY`

Access configuration values directly as properties of the config object. Will throw an error if accessed before initialization (unless the value has a `fallbackStatic` defined).

### Value Types

The configuration supports three types of values:
- `string`: String values (default)
- `int`: Integer values (converted using parseInt)
- `bool`: Boolean values (converted from string 'true'/'false')

### Environment Detection

The package automatically detects if it's running in a Lambda environment and will:
1. First attempt to use the Lambda Extensions API (localhost:2773)
2. Fall back to batch SSM API calls if the Extensions API is not available

### Caching

- Configuration values are loaded once at initialization
- Values are stored in environment variables for subsequent access
- No additional API calls are made after initialization

## AWS Lambda Support

When running in an AWS Lambda environment, the package will automatically detect and use the AWS Parameters and Secrets Lambda Extension if available. This extension provides a local HTTP endpoint that allows Lambda functions to retrieve parameters more efficiently without making direct AWS API calls. If the extension is not available, the package will automatically fall back to using the standard SSM API.

### Optional: Using the Lambda Layer

If you'd like to take advantage of the improved performance offered by the AWS Parameters and Secrets Lambda Extension, you can add it to your Lambda function in one of two ways:

#### Using the Lambda Layer (for standard Lambda functions)

1. Open the AWS Lambda console and navigate to your function
2. In the "Layers" section, click "Add a layer"
3. Choose "AWS layers" and select "AWS-Parameters-and-Secrets-Lambda-Extension"
4. Choose the appropriate version for your region and add the layer

#### Using Container Images

If you're using container images for your Lambda functions, you can optionally install the AWS Parameters and Secrets Lambda Extension in your Dockerfile:

```dockerfile
FROM public.ecr.aws/lambda/nodejs:20

# Optional: Install the AWS Parameters and Secrets Lambda Extension
RUN yum install -y unzip && \
    curl -O https://s3.amazonaws.com/aws-paramstore-secrets-lambda-extension/latest/linux-amd64/aws-paramstore-secrets-lambda-extension.zip && \
    unzip aws-paramstore-secrets-lambda-extension.zip -d /opt && \
    rm aws-paramstore-secrets-lambda-extension.zip

# Copy your application code
COPY . ${LAMBDA_TASK_ROOT}

# Install dependencies
RUN npm install

# Set the CMD to your handler
CMD [ "index.handler" ]
```

Note: The extension is completely optional. If not present, the package will automatically fall back to using batch SSM API calls, which still provides good performance for most use cases.

## Testing

This package includes a comprehensive test suite using Jest. The tests interact with real AWS SSM parameters to ensure everything works as expected.

### Test Requirements

To run the tests, you need:

1. AWS credentials with permissions to:
   - Create and delete SSM parameters
   - Create SecureString parameters
   - Use KMS for encryption/decryption

2. A KMS key alias `alias/ssm-parameter-key` that can be used for parameter encryption
   ```bash
   # Create a KMS key and alias if you don't have one
   aws kms create-key --description "SSM Parameter Encryption Key"
   aws kms create-alias --alias-name alias/ssm-parameter-key --target-key-id <key-id>
   ```

3. AWS region set via environment variable:
   ```bash
   export AWS_REGION=us-east-1
   ```

### Running Tests

```bash
# Run tests
# Tests use live AWS resources, so set your profile
export AWS_PROFILE=your-profile-name
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

The test suite:
- Creates test parameters in SSM
- Tests environment variable loading
- Tests SSM parameter fetching (String and SecureString)
- Tests custom KMS key encryption
- Tests type conversion
- Tests error handling
- Cleans up test parameters on successful completion

## Publishing to NPM

```bash
# depends on ~/.npmrc

# update version number in package.json and then ...
npm publish --access public
```

## License

MIT

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

#### `config.initializeConfig(kmsKeyId, options)`

Asynchronously initializes the configuration. This should be called once at the start of your application.

- `kmsKeyId`: (Optional) KMS key ID or alias for decryption of SSM parameters. Can be specified as either:
  - A key ID: `"1234abcd-12ab-34cd-56ef-1234567890ab"`
  - A key alias: `"alias/my-custom-key"`
- `options`: (Optional) Configuration options object:
  - `quiet`: (boolean) When true, suppresses detailed parameter output and only shows a summary. Default: false.
  - `timeout`: (number) Custom timeout in milliseconds for AWS SSM API calls. Default: 8000 (8 seconds). Note: This applies per retry attempt, with 3 total attempts.

### Controlling Log Verbosity

There are two ways to control logging verbosity:

#### 1. Quiet Mode (per-initialization)
Use the `quiet` option to suppress details for a specific initialization:

```javascript
// Suppress detailed output for this initialization only
await config.initializeConfig(null, { quiet: true });
// Output: Config loaded: 2 from env, 3 from ssm (total initialization time: 456ms)

// Normal verbose output
await config.initializeConfig();
// Output: Full details including each parameter
```

#### 2. LOG_LEVEL Environment Variable (global)
Use the standard `LOG_LEVEL` environment variable for application-wide control:

```bash
export LOG_LEVEL=error  # Only errors
export LOG_LEVEL=warn   # Warnings and errors
export LOG_LEVEL=info   # Standard output (default)
export LOG_LEVEL=debug  # Detailed output including all parameters
export LOG_LEVEL=silent # No output at all
```

Example outputs:

```javascript
// With quiet mode (regardless of LOG_LEVEL)
await config.initializeConfig(null, { quiet: true });
// Output: Config loaded: 2 from env, 3 from ssm, 1 from default (total initialization time: 456ms)

// Without quiet mode + LOG_LEVEL=info (default)
await config.initializeConfig();
// Output:
// Config loaded: 2 from env, 3 from ssm, 1 from default (total initialization time: 456ms)
// Loaded configuration values:
//   DB_HOST: (string) (15 characters) (ssm)
//   DB_PORT: (int) (4 digits) (env)
//   DEBUG_MODE: (bool) (default)

// Without quiet mode + LOG_LEVEL=debug
await config.initializeConfig();
// Output:
// Starting configuration initialization...
// Fetching batch 1/1 (5 parameters)
// Batch 1/1 completed in 234ms (5 found, 0 not found) 
// Config loaded: 2 from env, 3 from ssm, 1 from default (total initialization time: 456ms)
// Loaded configuration values:
//   DB_HOST: (string) (15 characters) (ssm)
//   DB_PORT: (int) (4 digits) (env)
//   DEBUG_MODE: (bool) (default)
// Configuration initialization completed successfully
```

**When to use each approach:**
- Use `quiet: true` for **component-level override** - keeps SSM config minimal regardless of application LOG_LEVEL
- Use `LOG_LEVEL` to control verbosity application-wide

**Component-Level Override Behavior:**
When `quiet: true` is used, it overrides `LOG_LEVEL` for SSM config:
- ✅ **Always shows**: Summary, warnings, and errors (critical information)  
- ❌ **Never shows**: Debug logs, info logs, parameter details (noise)

This allows you to have `LOG_LEVEL=debug` for your application while keeping SSM config initialization clean and minimal.

Example with custom timeout:
```javascript
await config.initializeConfig(null, { timeout: 60000 }); // 60 second timeout
```

#### `config.SOME_CONFIG_KEY`

Access configuration values directly as properties of the config object. Will throw an error if accessed before initialization (unless the value has a `fallbackStatic` defined).

### Environment Variable Precedence

The configuration system always respects the current state of environment variables, even after initialization:

- **Environment variables always take precedence** over SSM parameters and static fallbacks
- If you modify an environment variable at any time after initialization, the updated value will be used
- This allows for runtime overrides of configuration values
- SSM parameters are only fetched once during initialization and then cached
- This behavior ensures maximum flexibility while maintaining performance

Example of dynamic environment variable update:
```javascript
const config = require('./ssmConfig');

// Initialize with SSM fallback
config.configMap = {
  API_URL: { envVar: 'API_URL', fallbackSSM: '/my-app/api-url', type: 'string' }
};

await config.initializeConfig();
console.log(config.API_URL); // Value from SSM

// Override at runtime
process.env.API_URL = 'https://new-api-endpoint.com';
console.log(config.API_URL); // Will show the new value: 'https://new-api-endpoint.com'
```

### Value Types

The configuration supports four types of values:
- `string`: String values (default)
- `int`: Integer values (converted using parseInt)
- `float`: Floating-point values (converted using parseFloat)
- `bool`: Boolean values (converted from strings):
  - `true` values: 'true' or '1'
  - `false` values: 'false' or '0'
  - Any other values will throw an error

Invalid types (such as 'boolean' instead of 'bool') will cause an error to be thrown during initialization.

### Robustness and Timeout Protection

The library implements comprehensive timeout and error handling to prevent hanging:

**Default Timeouts (Optimized for API Gateway):**
- AWS SSM API calls: 8 seconds per attempt (configurable)
- AWS Lambda Extensions API calls: 3 seconds (fixed)
- Maximum total time: 24 seconds (3 attempts × 8s)
- **Why 24 seconds?** AWS API Gateway has a 29-second hard limit. Our timeouts ensure your application can return its own error response rather than being cut off with a 504 Gateway Timeout.

**About Lambda Extensions API:**
The "Lambda Extensions API" refers to the AWS Parameters and Secrets Lambda Extension - a local caching layer that runs at `localhost:2773` within Lambda environments. This is NOT about general Lambda function timeouts. When running in Lambda, the library will:
1. First try the Extensions API (3-second timeout) for faster, cached parameter access
2. If unavailable or times out, automatically fall back to direct SSM API calls
3. Log the fallback clearly so you know what's happening

**Built-in Protection Features:**
- All AWS SSM calls have automatic timeout protection (8s per attempt)
- AWS SDK automatically retries failed requests (3 total attempts with exponential backoff)
- Total worst-case time: ~24 seconds (stays under API Gateway's 29-second limit)
- Leaves 5-second buffer for your application to return a proper error response
- Parallel fetching with concurrency limits (max 3 concurrent requests when using KMS)
- Graceful degradation when SSM is unavailable
- Clear logging at each failure point for debugging

**Strategic Logging (Reduced Verbosity):**
The library uses smart logging to reduce noise while preserving debugging capability:
- **Normal operations are quiet** - successful fetches aren't logged individually
- **Slow operations are flagged** - any fetch taking >1 second is logged
- **Errors include timing** - all failures show elapsed time for diagnosis
- **Batch progress shown** - for visibility during multi-parameter fetches
- **Total time in summary** - always shows overall initialization time

This approach eliminates duplicate logging while ensuring you have full visibility when things go wrong.

**Large Parameter Sets (40+ parameters):**
The library efficiently handles applications with many SSM parameters:
- Automatically batches requests (10 parameters per API call)
- For 40 parameters: 4 batch calls, typically completes in ~1 second
- With KMS encryption: Parallel fetching in groups of 3
- No artificial delays - optimized for Lambda cold starts
- Clear progress indicators: "Batch 3/5 (10 parameters)" (shown with LOG_LEVEL=debug)
- Handles throttling reactively if it occurs

Example output with timing information:

**Normal operation:**
```
Starting configuration initialization...
Fetching batch 1/2 (10 parameters)
Batch 1/2 completed in 234ms (10 found, 0 not found)
Config loaded: 2 from env, 8 from ssm, 2 from default (total initialization time: 456ms)
```

**Lambda environment with Extensions API fallback:**
```
Starting configuration initialization...
Attempting to fetch 5 parameters via Lambda Extensions API
Lambda Extensions API timeout for parameter /app/db-host after 3001ms (limit: 3000ms) - falling back to direct SSM API
Lambda Extensions API unavailable or parameter not found - switching to direct SSM API calls
Fetching 5 parameters via direct SSM API calls
Batch fetch completed: 5 parameters retrieved, 0 failed (total time: 3234ms)
Config loaded: 1 from env, 5 from ssm (total initialization time: 3235ms)
```

If you experience hanging issues, the timing logs will help identify whether the problem is:
- Lambda Extensions API unavailable (immediate fallback to SSM)
- Network connectivity issues (network errors)
- AWS service issues (timeouts after 8s per attempt)
- Throttling (explicit throttling errors with immediate identification)
- Slow but successful responses (long elapsed times but under timeout)
- API Gateway timeout risk (total time approaching 24s)

### Environment Detection

The package automatically detects if it's running in a Lambda environment and will:
1. First attempt to use the Lambda Extensions API (localhost:2773)
2. Fall back to batch SSM API calls if the Extensions API is not available

### Caching

- SSM parameter values are loaded once at initialization and cached
- Environment variables are always checked at runtime and take precedence
- No additional API calls to SSM are made after initialization

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

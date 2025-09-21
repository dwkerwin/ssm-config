class ConfigLogger {
  constructor(options = {}) {
    // Original quiet mode behavior (preserved for backwards compatibility)
    this.isQuietMode = options.quiet || false;
    
    // Additional LOG_LEVEL support
    this.levels = {
      silent: 0,
      error: 1,
      warn: 2,
      info: 3,
      debug: 4
    };
    
    // If LOG_LEVEL is explicitly set, use it. Otherwise, use original behavior (debug shows unless quiet)
    const envLevel = process.env.LOG_LEVEL;
    if (envLevel) {
      this.currentLevel = this.levels[envLevel.toLowerCase()] || this.levels.info;
      this.useLogLevel = true;
    } else {
      // Original behavior: show debug unless quiet
      this.currentLevel = this.levels.debug;
      this.useLogLevel = false;
    }
    
    this.output = options.output || {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error
    };
  }

  setQuietMode(quiet) {
    this.isQuietMode = quiet;
  }

  debug(...args) {
    // In quiet mode, never show debug. Otherwise, respect LOG_LEVEL
    if (!this.isQuietMode && this.currentLevel >= this.levels.debug) {
      this.output.debug(...args);
    }
  }

  info(...args) {
    // In quiet mode, never show info. Otherwise, respect LOG_LEVEL
    if (!this.isQuietMode && this.currentLevel >= this.levels.info) {
      this.output.info(...args);
    }
  }

  // Summary is critical information that always shows unless LOG_LEVEL=silent
  summary(...args) {
    if (this.isQuietMode) {
      // Quiet mode: always show summary (component-level override)
      this.output.info(...args);
    } else {
      // Normal mode: always show summary unless LOG_LEVEL=silent
      // Summary is critical config loading information
      if (this.currentLevel > this.levels.silent) {
        this.output.info(...args);
      }
    }
  }

  warn(...args) {
    if (this.isQuietMode) {
      // Quiet mode: always show warnings (component-level override)
      this.output.warn(...args);
    } else {
      // Normal mode: respect LOG_LEVEL
      if (this.currentLevel >= this.levels.warn) {
        this.output.warn(...args);
      }
    }
  }

  error(...args) {
    if (this.isQuietMode) {
      // Quiet mode: always show errors (component-level override)
      this.output.error(...args);
    } else {
      // Normal mode: respect LOG_LEVEL
      if (this.currentLevel >= this.levels.error) {
        this.output.error(...args);
      }
    }
  }
}

module.exports = ConfigLogger;
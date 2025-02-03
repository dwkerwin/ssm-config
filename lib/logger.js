class ConfigLogger {
  constructor(options = {}) {
    this.isQuietMode = options.quiet || false;
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
    if (!this.isQuietMode) {
      this.output.debug(...args);
    }
  }

  info(...args) {
    if (!this.isQuietMode) {
      this.output.info(...args);
    }
  }

  // Always show summary, warnings and errors, regardless of quiet mode
  summary(...args) {
    this.output.info(...args);
  }

  warn(...args) {
    this.output.warn(...args);
  }

  error(...args) {
    this.output.error(...args);
  }
}

module.exports = ConfigLogger; 
require("@ariesclark/eslint-config/modern-module-resolution");

module.exports = {
  extends: ["@ariesclark/eslint-config"],
  parserOptions: {
    tsconfigRootDir: __dirname,
  }
}

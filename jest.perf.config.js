/**
 * 性能验证专用 jest 配置。
 *
 * 与主配置分离，因为 tests/perf 下的用例是测量而非断言型测试，
 * 不应该进入 npm test 的常规套件。
 *
 * 运行: npm run bench:cache
 */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/perf/**/*.perf.js'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest'
  }
};

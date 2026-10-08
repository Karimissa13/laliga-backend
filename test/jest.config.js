module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testPathIgnorePatterns: ['/node_modules/', '\\.e2e-spec\\.ts$'],
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
};

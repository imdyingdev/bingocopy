module.exports = {
  apps: [
    {
      name: "bingo",
      script: "src/index.js",
      watch: false,
      env: {
        NODE_ENV: "development"
      },
      env_production: {
        NODE_ENV: "production"
      }
    }
  ]
};

const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

// GitHub Pages project site base path
const isPages = process.env.GITHUB_PAGES === "true";
const publicPath = isPages ? "/foxys-premium-upscaling/" : "/";

module.exports = (env, argv) => {
  const mode = argv.mode || "development";
  return {
    entry: "./src/index.ts",
    output: {
      path: path.resolve(__dirname, "./dist"),
      filename: "main.[contenthash:8].js",
      publicPath,
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.(ts|js)$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "babel-loader",
              options: {
                presets: [
                  [
                    "@babel/preset-env",
                    {
                      targets: "defaults",
                    },
                  ],
                ],
              },
            },
            {
              loader: "ts-loader",
              options: {
                allowTsInNodeModules: false,
                transpileOnly: true,
              },
            },
          ],
        },
        {
          test: /\.css$/i,
          use: ["style-loader", "css-loader", "postcss-loader"],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: "src/index.html",
        filename: "index.html",
      }),
      new CleanWebpackPlugin(),
      new CopyWebpackPlugin({
        patterns: [
          { from: "src/img/*.svg", to: "[name][ext]" },
          { from: "src/img/*.png", to: "[name][ext]" },
        ],
      }),
    ],
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".css"],
    },
    devServer: {
      static: {
        directory: path.join(__dirname, "dist"),
      },
      compress: true,
      port: 8080,
      allowedHosts: "all",
      historyApiFallback: true,
    },
    mode,
    devtool: mode === "production" ? "source-map" : "eval-source-map",
    performance: {
      hints: false,
    },
  };
};

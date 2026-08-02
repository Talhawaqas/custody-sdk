/** @type {import('@storybook/react-vite').StorybookConfig} */
export default {
  stories: ["../src/**/*.stories.@(js|jsx)"],
  // Storybook 9+ folded the old @storybook/addon-essentials (controls, docs,
  // backgrounds, etc.) into core -- no separate addon package needed anymore.
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // Published under /custody-sdk/ on GitHub Pages (user.github.io/<repo>/) --
  // see .github/workflows/storybook.yml at the repo root.
  viteFinal: async (config) => {
    config.base = process.env.STORYBOOK_BASE_PATH || "/";
    return config;
  },
};

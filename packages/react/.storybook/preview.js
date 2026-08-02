import "./tailwind.css";

/** @type {import('@storybook/react-vite').Preview} */
export default {
  parameters: {
    backgrounds: {
      default: "inaya-dark",
      values: [{ name: "inaya-dark", value: "#060913" }],
    },
    layout: "centered",
  },
};

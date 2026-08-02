import InayaConnect from "./InayaConnect.jsx";

export default {
  title: "Inaya/InayaConnect",
  component: InayaConnect,
  parameters: {
    docs: {
      description: {
        component: "Wallet connect button that also derives a vault key once connected. This story shows the real initial (disconnected) state -- clicking Connect Wallet requires an actual injected Web3 wallet (e.g. MetaMask) in the browser running Storybook.",
      },
    },
  },
};

export const Default = {
  args: {
    label: "Connect Wallet",
  },
};

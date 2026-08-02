import InayaUploader from "./InayaUploader.jsx";

export default {
  title: "Inaya/InayaUploader",
  component: InayaUploader,
  parameters: {
    docs: {
      description: {
        component: "Drag-and-drop upload widget. `connection`/`vaultKey` are normally produced by <InayaConnect/>; these stories use stand-ins to show each visual state without needing a live wallet or backend.",
      },
    },
  },
};

export const Disconnected = {
  args: {
    connection: null,
    vaultKey: null,
    pinShard: async () => "stub-cid",
  },
};

export const ReadyToUpload = {
  args: {
    connection: {},
    vaultKey: {},
    pinShard: async () => "stub-cid",
  },
};

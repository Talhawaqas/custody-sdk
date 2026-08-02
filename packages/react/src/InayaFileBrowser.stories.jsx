import InayaFileBrowser from "./InayaFileBrowser.jsx";

export default {
  title: "Inaya/InayaFileBrowser",
  component: InayaFileBrowser,
  parameters: {
    docs: {
      description: {
        component: "Decentralized-Drive-style file browser over the Metadata client. Without `apiBaseUrl` pointed at a real deployed backend (see examples/nextjs-metadata-api-routes.js in the SDK repo), this story will show its own real \"failed to fetch\" error state -- that's expected in isolation, not a bug in the story.",
      },
    },
  },
};

export const Default = {
  args: {
    connection: {},
    owner: "0x1234567890123456789012345678901234567890",
    apiBaseUrl: "",
  },
};

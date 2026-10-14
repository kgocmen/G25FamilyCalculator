importScripts("mixture.js");

self.onmessage = ({ data }) => {
  const { requestId, target, references } = data;
  try {
    const result = self.G25Mixtures.estimate(target, references, (fits) => {
      self.postMessage({ requestId, kind: "parents", fits });
    });
    self.postMessage({ requestId, kind: "grandparents", fits: result.grandparents });
  } catch (error) {
    self.postMessage({ requestId, kind: "error", message: error.message });
  }
};

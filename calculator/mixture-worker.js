importScripts("mixture.js");

self.onmessage = ({ data }) => {
  const { requestId, target, modernReferences, references } = data;
  try {
    const relaxed = self.G25Mixtures.estimateRelaxedByCategory(target, references, 100);
    self.postMessage({ requestId, kind: "relaxed", fits: relaxed });
    const strict = self.G25Mixtures.estimateStrict(target, modernReferences, (fits) => {
      self.postMessage({ requestId, kind: "strictParents", fits });
    });
    self.postMessage({ requestId, kind: "strictGrandparents", fits: strict.grandparents });
  } catch (error) {
    self.postMessage({ requestId, kind: "error", message: error.message });
  }
};

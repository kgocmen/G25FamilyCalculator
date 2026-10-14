importScripts("mixture.js");

self.onmessage = ({ data }) => {
  const { requestId, target, modernReferences, references } = data;
  try {
    const strict = self.G25Mixtures.estimateStrict(target, modernReferences, (fits) => {
      self.postMessage({ requestId, kind: "strictParents", fits });
    });
    self.postMessage({ requestId, kind: "strictGrandparents", fits: strict.grandparents });
    const relaxed = self.G25Mixtures.estimateRelaxed(target, references, 100);
    self.postMessage({ requestId, kind: "relaxed", fits: relaxed });
  } catch (error) {
    self.postMessage({ requestId, kind: "error", message: error.message });
  }
};

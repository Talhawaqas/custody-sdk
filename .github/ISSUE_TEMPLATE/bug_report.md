---
name: Bug report
about: Something in the SDK doesn't behave the way SDK_GUIDE.md says it should
title: ""
labels: bug
assignees: ""
---

**What happened**
A clear description of the incorrect behavior.

**Expected behavior**
What you expected instead, ideally with a link to the relevant `SDK_GUIDE.md` section if there is one.

**Minimal repro**
```js
// The smallest snippet that reproduces the problem.
```

**Error output**
```
// If an InayaError was thrown, include err.message, err.code, and err.cause if present —
// these are far more useful than a stack trace alone for narrowing down what went wrong.
```

**Environment**
- SDK version: (see `package.json`)
- Runtime: (browser + version / Node version / React Native + Expo SDK version)
- Network: BNB Chain Testnet (default) or other?

**Have you checked `SDK_GUIDE.md`'s "Known Limitations" section?**
Several non-obvious behaviors (stale ABIs found and fixed, Custody's write-once design, retry policy per operation) are already documented there with the story behind them — worth a quick check before filing.

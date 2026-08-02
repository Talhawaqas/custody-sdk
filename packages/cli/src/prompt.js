// packages/cli/src/prompt.js
//
// Minimal hidden-input prompt for secrets (private key, CLI password) —
// implemented directly on readline rather than pulling in an extra
// dependency just for password masking.

import readline from "node:readline";

export function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const output = rl._writeToOutput;
    let hidden = false;
    rl._writeToOutput = function (str) {
      if (hidden && str !== "\n" && str !== "\r\n") return;
      output.call(rl, str);
    };
    rl.question(question, (answer) => {
      rl._writeToOutput = output;
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    hidden = true;
  });
}

export function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

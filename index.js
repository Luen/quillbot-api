const puppeteer = require('puppeteer');

function truncate(str, n) {
  if (str.length <= n) { return str; }
  const subString = str.match(/\b[\w']+(?:[^\w\n]+[\w']+){0,125}\b/g); // split up text into n words
  return subString[0].slice(0, subString[0].lastIndexOf('.') + 1); // find nearest end of stentence
}

async function quillbot(text) {
  try {
    const inputSelector = 'div#inputText';
    const buttonSelector = 'button.quillArticleBtn';
    const outputSelector = 'div#outputText';
    let str = text.trim();
    let parts = [];
    let output = '';

    // 125 words per paraphrase for a free account
    if (str.match(/(\w+)/g).length > 125) {
      while (str.match(/(\w+)/g).length > 125) {
        const part = truncate(str, 125);
        str = str.slice(part.length);
        parts.push(part);
      }
      parts.push(str);
    } else {
      parts.push(str);
    }

    const browser = await puppeteer.launch({ headless: false });

    const page = await browser.newPage();
    await page.goto('https://quillbot.com/');

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // Wait for input
      const input = await page.waitForSelector(inputSelector);

      await page.evaluate((selector) => { document.querySelector(selector).textContent = ''; }, inputSelector);
      // Input the string in the text area
      await input.type(' ');
      // await page.waitFor(1000);
      /* await page.evaluate((selector, text) => {
        document.querySelector(selector).textContent = text;
      }, inputSelector, part); */
      await input.type(part);

      // Generate the result
      await page.click(buttonSelector);

      // wait for paraphising to complete - button to become enabled
      await page.waitForSelector(`${buttonSelector}:not([disabled])`);

      const paraphrased = await page.evaluate((selector) => document.querySelector(selector).textContent, outputSelector);

      output += paraphrased;

    }
    // Display result
    console.log(output);

    browser.close();
  } catch (error) {
    console.log(`Error: ${error}`);
    process.exit();
  }
}

quillbot('TCP is a connection-oriented protocol, which means that the end-to-end communications is set up using handshaking. Once the connection is set up, user data may be sent bi-directionally over the connection. Compared to TCP, UDP is a simpler message based connectionless protocol, which means that the end-to-end connection is not dedicated and information is transmitted in one direction from the source to its destination without verifying the readiness or state of the receiver. TCP controls message acknowledgment, retransmission and timeout. TCP makes multiple attempts to deliver messages that get lost along the way, In TCP therefore, there is no missing data, and if ever there are multiple timeouts, the connection is dropped. When a UDP message is sent there is no guarantee that the message it will reach its destination; it could get lost along the way.');

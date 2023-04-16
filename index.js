const puppeteer = require('puppeteer');

function truncate(str, n) {
  if (str.length <= n) {
    return str;
  }
  const regex = new RegExp(`\\b[\\w']+(?:[^\\w\\n]+[\\w']+){0,${n}}\\b`, 'g');
  const subString = str.match(regex); // split up text into n words
  return subString[0].slice(0, subString[0].lastIndexOf('.') + 1); // find nearest end of sentence
}

async function quillbot(text) {
  try {
    //const inputSelector = 'div#inputText';
    //const inputSelector = 'div#paraphraser-input-box';
    const placeholderText = 'To rewrite text, enter or paste it here and press Paraphrase.';
    const inputSelector = `div[placeholder="${placeholderText}"]`;
    const buttonSelector = 'button.quillArticleBtn';
    const outputSelector = 'div#paraphraser-output-box';
    const numberOfCharacters = 125;
    let str = text.trim();
    const parts = [];
    let output = '';

    // 125 words per paraphrase for a free account
    if (str.match(/(\w+)/g).length > numberOfCharacters) {
      while (str.match(/(\w+)/g).length > numberOfCharacters) {
        const part = truncate(str, numberOfCharacters).trim();
        str = str.slice(part.length);
        parts.push(part);
      }
      parts.push(str.trim());
    } else {
      parts.push(str);
    }

    const browser = await puppeteer.launch({ headless: false });

    const page = await browser.newPage();
    await page.goto('https://quillbot.com/', { waitUntil: 'networkidle0' });

    // Wait for input
    const input = await page.waitForSelector(inputSelector);
    console.log('Input found');

    for (let i = 0; i < parts.length; i += 1) {
      console.log('Paraphrasing part', i + 1, 'of', parts.length);

      const part = parts[i];

      //await page.evaluate((selector) => {
      //  document.querySelector(selector).textContent = '';
      //}, inputSelector);

      // Input the string in the text area
      /* await page.evaluate((selector, text) => {
        document.querySelector(selector).textContent = text;
      }, inputSelector, part); */
      // await input.type(part);
      //await page.focus(inputSelector);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await input.click();
      await input.type(' ');
      await new Promise((resolve) => setTimeout(resolve, 100));
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.up('Delete');
      // Set clipboard content
      await page.evaluate(async (text) => {
        await navigator.clipboard.writeText(text);
      }, part);
      //await clipboardy.write(part);
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyV');
      await page.keyboard.up('Control');
      //await input.type(' ');

      // Generate the result
      await page.click(buttonSelector);

      // wait for paraphrasing to complete - button to become enabled
      // await page.waitForSelector(`${buttonSelector}:not([disabled])`);
      // await second div in buttonSelector to be removed from dom
      await page.waitForSelector(`${buttonSelector} div:nth-child(2)`, { hidden: true });
      console.log('Paraphrasing complete');

      const paraphrased = await page.evaluate(
        (selector) => document.querySelector(selector).textContent,
        outputSelector,
      );

      output += paraphrased;
    }

    console.log('Paraphrased:');
    console.log(output); // Display result

    //await new Promise((resolve) => setTimeout(resolve, 20000));

    browser.close();

    return output;

  } catch (error) {
    console.log(`Error: ${error}`);
  }
}

exports.quillbot = quillbot;

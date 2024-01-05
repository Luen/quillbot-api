const puppeteer = require('puppeteer');

function truncate(str, n) {
  if (str.length <= n) {
    return str;
  }
  const regex = new RegExp(`\\b[\\w']+(?:[^\\w\\n]+[\\w']+){0,${n}}\\b`, 'g');
  const subString = str.match(regex); // split up text into n words
  return subString[0].slice(0, subString[0].lastIndexOf('.') + 1); // find nearest end of sentence
}

// Function to get the correct input selector
async function getInputSelector(page) {
  const placeholderText = 'To rewrite text, enter or paste it here and press "Paraphrase."';
  const inputSelectors = [
    '#inputText',
    '#paraphraser-input-box',
    `div[placeholder="${placeholderText}"]`,
  ];

  for (const selector of inputSelectors) {
    const exists = await page.$(selector) !== null;
    if (exists) {
      return selector; // Return the selector if found
    }
  }

  console.error('Error: Unable to find a valid input selector.');
  return null; // Return null if no valid selector is found
}

// Function to get the input field using the provided selector
async function getInputField(page, inputSelector) {
  if (!inputSelector) {
    return null; // Return null if the inputSelector is not provided
  }

  try {
    const input = await page.waitForSelector(inputSelector, { visible: true, timeout: 5000 });
    return input; // Return the input field if found
  } catch (error) {
    console.error(`Error: Unable to find the input field with the selector: ${inputSelector}`);
    return null; // Return null if the input field is not found
  }
}

// Function to clear the input field
async function clearInputField(page, inputSelector, inputField) {
  await inputField.click();
  await inputField.type(' ');

  // Clear the text area using JavaScript
  await page.evaluate((selector) => {
    const inputElement = document.querySelector(selector);
    if (inputElement) {
      inputElement.textContent = '';
      if (inputElement.value) {
        inputElement.value = ''; // Clear value for input elements
      }
    }
  }, inputSelector);
  // console.log('Input cleared using JavaScript');

  // Additional step to ensure complete clearing using keyboard commands
  await page.focus(inputSelector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace'); // Using 'Backspace' instead of 'Delete' for broader compatibility
  // console.log('Input cleared using keyboard commands');
}

// Function to get inputContent
function getInputContent(page, inputSelector) {
  return page.evaluate((selector) => {
    const inputElement = document.querySelector(selector);
    if (inputElement) {
      return inputElement.textContent;
    }
    return null;
  }, inputSelector);
}

// Function to input text into the specified field
async function inputString(page, inputSelector, inputField, text) {
  // Attempt to change textContent directly using JavaScript
  await page.evaluate((selector, textString) => {
    const inputElement = document.querySelector(selector);
    if (inputElement) {
      inputElement.textContent = textString;
      if (inputElement.value !== undefined) {
        inputElement.value = textString; // For input elements
      }
    }
  }, inputSelector, text);

  // Attempt to set clipboard content and paste it
  await page.evaluate(async (textString) => {
    // eslint-disable-next-line no-undef
    await navigator.clipboard.writeText(textString);
  }, text);
  await page.focus(inputSelector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyV');
  await page.keyboard.up('Control');

  const inputContent = await getInputContent(page, inputSelector);
  if (inputContent !== text) {
    // Attempt to type it out
    inputField.type(text);
  }
}

// Function to get the correct button selector
async function getButtonSelector(page) {
  const buttonSelectors = [
    'button.quillArticleBtn',
    '[aria-label="Rephrase (Cmd + Return)"] button',
    '[aria-label="Paraphrase (Cmd + Return)"] button',
    "//div[contains(text(), 'Paraphrase') or contains(text(), 'Rephrase')]/ancestor::button",
  ];

  for (const selector of buttonSelectors) {
    let exists;
    if (selector.startsWith('//')) { // XPath selector
      exists = await page.$x(selector).length > 0;
    } else { // CSS selector
      exists = await page.$(selector) !== null;
    }
    if (exists) {
      return selector; // Return the selector if found
    }
  }

  console.error('Error: Unable to find a valid button selector.');
  return null; // Return null if no valid selector is found
}

// Function to click the appropriate button
async function clickParaphraseButton(page, buttonSelector) {
  if (!buttonSelector) {
    return false; // Return false if the buttonSelector is not provided
  }

  let button;
  if (buttonSelector.startsWith('//')) { // XPath selector
    const [firstButton] = await page.$x(buttonSelector);
    button = firstButton;
  } else { // CSS selector
    button = await page.$(buttonSelector);
  }

  if (button) {
    await button.click();
    return true;
  }
  return false;
}

// Function to check if the form is submitted
async function waitForFormSubmission(page, buttonSelector) {
  try {
    // Wait for paraphrasing to complete - button to become enabled
    // await page.waitForSelector(`${buttonSelector}:not([disabled])`);

    // await second div in buttonSelector to be removed from dom
    // await page.waitForSelector(`${buttonSelector} div:nth-child(2)`, { hidden: true });

    // Implement the logic to check if the form is submitted
    // const isDisabled = await page.$eval(buttonSelector, (button) => button.disabled);
    // return isDisabled;

    // Wait for the new div to appear within the button, indicating the process has started
    await page.waitForSelector(`${buttonSelector} div:nth-child(2)`, { visible: true });

    // Then, wait for the new div to disappear, indicating the process has finished
    await page.waitForSelector(`${buttonSelector} div:nth-child(2)`, { hidden: true });

    return true;
  } catch (error) {
    console.error('Error: Process did not complete in the expected time.');
    return false;
  }
}

// Function to submit the form
async function submitForm(page, buttonSelector) {
  /*
  // Try submitting the form using keyboard shortcut
  await page.focus(inputSelector);
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');

  // Check if the form submits
  const isSubmitted = await isProcessComplete(page, buttonSelector);
  if (isSubmitted) {
    return true;
  }
  */

  // Try clicking the paraphrase button as a fallback
  const isClicked = await clickParaphraseButton(page, buttonSelector);
  if (!isClicked) {
    console.log('Failed to find and click the paraphrase button.');
    return false;
  }

  const isSubmitted = await waitForFormSubmission(page, buttonSelector);
  if (!isSubmitted) {
    return false;
  }

  return true;
}

// Function to get the output content
async function getOutputContent(page, outputSelector) {
  try {
    const content = await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return element ? element.textContent : null;
    }, outputSelector);

    if (content === null) {
      console.log('Output element not found or no content.');
      return null;
    }

    return content;
  } catch (error) {
    console.error('Error retrieving output content:', error);
    return null;
  }
}

async function quillbot(text) {
  let browser;  // Declare browser outside of try-catch so it's accessible in finally
  try {
    const outputSelector = '#paraphraser-output-box';

    const numberOfCharacters = 125;
    let str = text.trim();
    const parts = [];
    let output = '';

    // 125 words per paraphrase for a free account
    // So break up the text into parts of 125 words
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

    browser = await puppeteer.launch({
      // headless: 'new',
      headless: false,
    });

    const page = await browser.newPage();
    await page.goto('https://quillbot.com/', { waitUntil: 'networkidle0' });

    // Wait for input
    const inputSelector = await getInputSelector(page);
    const inputField = await getInputField(page, inputSelector);
    if (!inputField) {
      // Handle the case where the input field wasn't found
      console.log('Input field not found. Exiting script.');
      return; // Exit the function, browser will be closed in finally
    }
    console.log('Input found');

    // Go through each part and paraphrase it
    for (let i = 0; i < parts.length; i += 1) {
      console.log('Paraphrasing part', i + 1, 'of', parts.length);

      const part = parts[i];

      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Clear the text area
      await clearInputField(page, inputSelector, inputField);

      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Input the string in the text area
      await inputString(page, inputSelector, inputField, part);

      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const buttonSelector = await getButtonSelector(page);

      const isSubmitted = await submitForm(page, buttonSelector);
      if (!isSubmitted) {
        // Handle submission failure
        console.log('Form submission failed. Exiting script.');
        return;
      }

      // Get the paraphrased content
      const outputContent = await getOutputContent(page, outputSelector);
      if (outputContent) {
        output += outputContent;
      } else {
        // Handle the case where no output content is retrieved
        console.log('Output content not found. Exiting script.');
        return;
      }

      console.log('Paraphrasing complete', i + 1, 'of', parts.length);

      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log('Paraphrasing complete');
    return output;
  } catch (error) {
    console.log(`Error: ${error}`);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

exports.quillbot = quillbot;

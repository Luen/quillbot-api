const {
    safePageOperation,
    saveHTMLForDebug,
    setupBrowser,
    navigateToUrl,
    waitForPageInitialization,
    closeBrowser,
    clearInputField,
    inputString,
    getOutputContent,
    wait,
} = require('./utils');

const PARAPHRASER_URL = 'https://quillbot.com/paraphrasing-tool';
const OUTPUT_SELECTOR = '#paraphraser-output-box';
const NUMBER_OF_CHARACTERS = 125; // 125 words per paraphrase for a free account

/**
 * Truncate text to approximately n words, ending at nearest sentence boundary
 * @param {string} str - Text to truncate
 * @param {number} n - Target number of words
 * @returns {string} Truncated text
 */
function truncate(str, n) {
    if (str.length <= n) {
        return str;
    }
    const regex = new RegExp(`\\b[\\w']+(?:[^\\w\\n]+[\\w']+){0,${n}}\\b`, 'g');
    const subString = str.match(regex); // split up text into n words
    return subString[0].slice(0, subString[0].lastIndexOf('.') + 1); // find nearest end of sentence
}

/**
 * Get the correct input selector for the paraphrasing tool
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<string|null>} CSS selector or null
 */
async function getInputSelector(page) {
    const placeholderText = 'To rewrite text, enter or paste it here and press "Paraphrase."';
    // Known working selector first for speed
    const inputSelectors = [
        '#paraphraser-input-box', // Known working selector - try first
        '#inputText',
        '[data-testid="paraphraser-input-box"]',
        '[data-testid="input-text-box"]',
        'div[contenteditable="true"][placeholder*="paste" i]',
        'div[contenteditable="true"][placeholder*="Paste" i]',
        'textarea[placeholder*="paste" i]',
        'textarea[placeholder*="Paraphrase" i]',
        'div[placeholder*="paste" i]',
        `div[placeholder="${placeholderText}"]`,
        '[aria-label*="paste" i]',
        '[aria-label*="input" i]',
        '.paraphraser-input-box',
        '[role="textbox"]',
    ];

    for (const selector of inputSelectors) {
        try {
            const exists = await safePageOperation(async () => {
                const element = await page.$(selector);
                if (!element) return false;

                // Check if element is visible and interactive
                const isVisible = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return (
                        style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && el.offsetParent !== null
                        && rect.width > 0
                        && rect.height > 0
                    );
                }, selector);
                return isVisible;
            }, 2, page); // Reduced retries to avoid long waits
            if (exists) {
                console.log(`Found input selector: ${selector}`);
                return selector;
            }
        } catch (error) {
            // Try next selector
        }
    }

    console.error('Error: Unable to find a valid input selector.');
    return null;
}

/**
 * Get the input field using the provided selector
 * @param {Object} page - Puppeteer page object
 * @param {string} inputSelector - CSS selector for the input field
 * @returns {Promise<Object|null>} Input element or null
 */
async function getInputField(page, inputSelector) {
    if (!inputSelector) {
        return null;
    }

    try {
        const input = await safePageOperation(async () => page.waitForSelector(inputSelector, {
            visible: true,
            timeout: 10000,
        }));
        return input;
    } catch (error) {
        console.error(`Error: Unable to find the input field with the selector: ${inputSelector}`);
        return null;
    }
}

/**
 * Get the correct button selector for the paraphrase button
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<string|null>} CSS/XPath selector or null
 */
async function getButtonSelector(page) {
    // Updated selectors based on actual HTML structure - known working selector first
    const buttonSelectors = [
        '[data-testid="pphr/input_footer/paraphrase_button"]', // Primary selector from HTML
        'button[data-testid="pphr/input_footer/paraphrase_button"]',
        '[aria-label="Paraphrase (Ctrl + Enter)"] button',
        '[aria-label="Rephrase (Cmd + Return)"] button',
        '[aria-label="Paraphrase (Cmd + Return)"] button',
        'button.quillArticleBtn',
        'button[aria-label*="Paraphrase"]',
        'button[aria-label*="Rephrase"]',
        "//div[contains(text(), 'Paraphrase') or contains(text(), 'Rephrase')]/ancestor::button",
    ];

    for (const selector of buttonSelectors) {
        try {
            const exists = await safePageOperation(async () => {
                if (selector.startsWith('//')) {
                    // XPath selector
                    const elements = await page.$x(selector);
                    return elements.length > 0;
                }
                // CSS selector
                return (await page.$(selector)) !== null;
            });
            if (exists) {
                return selector;
            }
        } catch (error) {
            // Try next selector
        }
    }

    console.error('Error: Unable to find a valid button selector.');
    return null;
}

/**
 * Click the paraphrase button
 * @param {Object} page - Puppeteer page object
 * @param {string} buttonSelector - CSS/XPath selector for the button
 * @returns {Promise<boolean>} True if clicked successfully
 */
async function clickParaphraseButton(page, buttonSelector) {
    if (!buttonSelector) {
        return false;
    }

    try {
        await safePageOperation(async () => {
            let button;
            if (buttonSelector.startsWith('//')) {
                // XPath selector
                const buttons = await page.$x(buttonSelector);
                button = buttons[0];
            } else {
                // CSS selector
                button = await page.$(buttonSelector);
            }

            if (button) {
                await button.click();
                return true;
            }
            return false;
        });
        return true;
    } catch (error) {
        console.error(`Error clicking paraphrase button: ${error.message}`);
        return false;
    }
}

/**
 * Wait for form submission to complete
 * @param {Object} page - Puppeteer page object
 * @param {string} buttonSelector - CSS selector for the button
 * @returns {Promise<boolean>} True if submission completed
 */
async function waitForFormSubmission(page, buttonSelector) {
    try {
        // Approach 1: Wait for output content to appear (most reliable)
        try {
            await safePageOperation(async () => {
                await page.waitForSelector(OUTPUT_SELECTOR, {
                    visible: true,
                    timeout: 30000,
                });
            });

            // Additional wait to ensure content is loaded
            await wait(2000);
            return true;
        } catch (error) {
            // If that doesn't work, try waiting for button loading indicator
            console.log('Output not detected, waiting for button state change...');
        }

        // Approach 2: Wait for loading indicator to appear and disappear (fallback)
        try {
            await safePageOperation(async () => {
                await page.waitForSelector(`${buttonSelector} div:nth-child(2)`, {
                    visible: true,
                    timeout: 5000,
                });
            });

            await safePageOperation(async () => {
                await page.waitForSelector(`${buttonSelector} div:nth-child(2)`, {
                    hidden: true,
                    timeout: 30000,
                });
            });
            return true;
        } catch (error) {
            console.error('Error: Process did not complete in the expected time.');
            return false;
        }
    } catch (error) {
        console.error(`Error waiting for form submission: ${error.message}`);
        return false;
    }
}

/**
 * Submit the paraphrase form
 * @param {Object} page - Puppeteer page object
 * @param {string} buttonSelector - CSS/XPath selector for the button
 * @returns {Promise<boolean>} True if submitted successfully
 */
async function submitForm(page, buttonSelector) {
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

/**
 * Select language for paraphrasing
 * @param {Object} page - Puppeteer page object
 * @param {string} languageName - Name of the language to select
 */
async function selectLanguage(page, languageName) {
    const menuButtonXPath = "//button[contains(., 'All')]";

    try {
        await safePageOperation(async () => {
            // Check if page.$x is available (might not be if page is in bad state)
            if (typeof page.$x !== 'function') {
                throw new Error('Page.$x is not available - page may be in invalid state');
            }
            // Wait for the button to be visible and click it
            const menuButtons = await page.$x(menuButtonXPath);
            if (menuButtons.length > 0) {
                await menuButtons[0].click();
            } else {
                throw new Error('Language menu button not found');
            }
        });

        // Wait a moment for animation if needed
        await wait(500);

        await safePageOperation(async () => {
            // XPath to find a language option by its text content
            const languageOptionXPath = `//li//p[contains(text(), "${languageName}")]`;

            // Wait for the language option to be visible and click it
            if (typeof page.$x !== 'function') {
                throw new Error('Page.$x is not available - page may be in invalid state');
            }
            const languageOptions = await page.$x(languageOptionXPath);
            if (languageOptions.length > 0) {
                await languageOptions[0].click();
                console.log(`Language set to "${languageName}".`);
            } else {
                throw new Error(`Language option "${languageName}" not found.`);
            }
        });
    } catch (error) {
        console.error(`Error selecting language "${languageName}": ${error.message}`);
        // Don't throw - language selection is optional
    }
}

/**
 * Select mode for paraphrasing
 * @param {Object} page - Puppeteer page object
 * @param {string} modeName - Name of the mode to select
 */
async function selectMode(page, modeName) {
    // Map mode names to their data-testid values
    const modeTestIds = {
        Standard: 'pphr/header/modes/standard',
        Fluency: 'pphr/header/modes/fluency',
        Humanize: 'pphr/header/modes/natural',
        Natural: 'pphr/header/modes/natural',
        Formal: 'pphr/header/modes/formal',
        Academic: 'pphr/header/modes/academic',
        Simple: 'pphr/header/modes/simple',
        Creative: 'pphr/header/modes/creative',
        Expand: 'pphr/header/modes/expand',
        Shorten: 'pphr/header/modes/shorten',
        Custom: 'pphr/header/modes/custom',
    };

    // Normalize mode name (capitalize first letter)
    const normalizedModeName = modeName.charAt(0).toUpperCase() + modeName.slice(1);
    const testId = modeTestIds[normalizedModeName] || modeTestIds[modeName];

    if (!testId) {
        console.log(`Mode "${modeName}" not recognized. Available modes: ${Object.keys(modeTestIds).join(', ')}`);
        return;
    }

    try {
        await safePageOperation(async () => {
            // Wait for the mode button with the specific data-testid
            const selector = `[data-testid="${testId}"]`;
            await page.waitForSelector(selector, {visible: true, timeout: 10000});
            await page.click(selector);
        });

        // Wait for mode selection to complete
        await wait(500);

        console.log(`Mode set to "${modeName}".`);
    } catch (error) {
        console.log(`Error while selecting mode "${modeName}": ${error.message}`);
        // Don't throw - mode selection is optional
    }
}

/**
 * Select synonyms level for paraphrasing
 * @param {Object} page - Puppeteer page object
 * @param {string} value - Synonyms level (0, 50, or 100)
 */
async function selectSynonymsLevel(page, value) {
    // Ensure the value is within the allowed range
    const sanitizedValue = Math.max(0, Math.min(parseInt(value, 10) || 0, 100)); // Assuming the range is 0 to 100

    try {
        const result = await safePageOperation(async () => page.evaluate((sliderValue) => {
            // Find the slider by its unique characteristics
            const slider = document.querySelector(
                'input[type="range"][data-testid="synonyms-slider"]'
            );
            if (slider) {
                // Set the value of the slider
                slider.value = sliderValue;

                // Dispatch events to notify the page of the change
                const events = ['change', 'input']; // Add any other events the slider might listen to
                events.forEach((event) => {
                    slider.dispatchEvent(new Event(event, {bubbles: true}));
                });

                return 'Success';
            }
            return 'Slider not found';
        }, sanitizedValue));

        console.log(result); // Logs 'Success' if the slider was found and adjusted, otherwise 'Slider not found'
    } catch (error) {
        console.error(`Error setting synonyms level: ${error.message}`);
    }
}

/**
 * Element check function for paraphrasing page
 * @returns {boolean} True if key elements are present
 */
function paraphraserElementCheck() {
    // Check multiple possible selectors - known working selector first
    const selectors = [
        '#paraphraser-input-box', // Known working selector - try first
        '#inputText',
        '[data-testid="paraphraser-input-box"]',
        '[data-testid="input-text-box"]',
        'div[contenteditable="true"][placeholder*="paste" i]',
        'textarea[placeholder*="paste" i]',
        'div[placeholder*="paste" i]',
        '[aria-label*="paste" i]',
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            // Check if visible
            const style = window.getComputedStyle(element);
            if (style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Paraphrase text using QuillBot
 * @param {string} text - Text to paraphrase
 * @param {Object} options - Options object
 * @param {boolean|string} options.headless - Browser headless mode (default: 'new')
 * @param {string} options.language - Language for paraphrasing (e.g., 'English (AU)')
 * @param {string} options.mode - Paraphrasing mode (Standard, Fluency, etc.)
 * @param {string} options.synonymsLevel - Synonyms level (0, 50, or 100)
 * @returns {Promise<string|null>} Paraphrased text or null on error
 */
async function paraphraser(text, options = {}) {
    let browser;
    let page;
    try {
        let str = text.trim();
        const parts = [];
        let output = '';

        // Break up the text into parts of 125 words
        if (str.match(/(\w+)/g).length > NUMBER_OF_CHARACTERS) {
            while (str.match(/(\w+)/g).length > NUMBER_OF_CHARACTERS) {
                const part = truncate(str, NUMBER_OF_CHARACTERS).trim();
                str = str.slice(part.length);
                parts.push(part);
            }
            parts.push(str.trim());
        } else {
            parts.push(str);
        }

        // Setup browser and page
        const {browser: browserInstance, page: pageInstance, isDev} = await setupBrowser(options);
        browser = browserInstance;
        page = pageInstance;

        console.log('Navigating to QuillBot Paraphrasing Tool...');
        await navigateToUrl(page, PARAPHRASER_URL);

        // Wait for page initialization
        await waitForPageInitialization(page, paraphraserElementCheck);

        // Save initial HTML for debugging
        await saveHTMLForDebug(page, 'initial-load.html', isDev);
        console.log('Initial page loaded and saved');

        // Select language before paraphrasing - non-blocking
        if (options.language) {
            console.log(`Attempting to select language: ${options.language}`);
            try {
                await selectLanguage(page, options.language);
                await wait(1000);
            } catch (error) {
                console.log(`Language selection failed (continuing): ${error.message}`);
            }
        }

        // Select mode before paraphrasing - non-blocking
        if (options.mode) {
            console.log(`Attempting to select mode: ${options.mode}`);
            try {
                await selectMode(page, options.mode);
                await wait(1000);
            } catch (error) {
                console.log(`Mode selection failed (continuing): ${error.message}`);
            }
        }

        // Select synonyms level before paraphrasing - non-blocking
        if (options.synonymsLevel) {
            console.log(`Attempting to set synonyms level: ${options.synonymsLevel}`);
            try {
                await selectSynonymsLevel(page, options.synonymsLevel);
                await wait(1000);
            } catch (error) {
                console.log(`Synonyms level setting failed (continuing): ${error.message}`);
            }
        }

        // Wait for input - try multiple times with fresh page references
        let inputSelector = null;
        let inputField = null;
        const retries = 3;

        for (let retry = 0; retry < retries; retry += 1) {
            try {
                inputSelector = await getInputSelector(page);
                if (inputSelector) {
                    inputField = await getInputField(page, inputSelector);
                    if (inputField) {
                        break;
                    }
                }
            } catch (error) {
                console.log(`Attempt ${retry + 1} failed to find input: ${error.message}`);
                if (retry < retries - 1) {
                    await wait(2000);
                    await saveHTMLForDebug(page, `retry-${retry + 1}-input-search.html`, isDev);
                }
            }
        }

        if (!inputField || !inputSelector) {
            // Handle the case where the input field wasn't found
            await saveHTMLForDebug(page, 'input-not-found.html', isDev);
            console.log('Input field not found. Exiting script.');
            console.log('Check debug-html/input-not-found.html for page state');
            return null;
        }
        console.log('Input found');
        await saveHTMLForDebug(page, 'before-paraphrasing.html', isDev);

        // Go through each part and paraphrase it
        for (let i = 0; i < parts.length; i += 1) {
            console.log('Paraphrasing part', i + 1, 'of', parts.length);

            const part = parts[i];

            try {
                // Refresh page references if needed
                const currentInputField = inputField;
                const currentInputSelector = inputSelector;
                const refreshedField = await safePageOperation(async () => {
                    if (!currentInputField || !await page.$(currentInputSelector)) {
                        console.log('Re-acquiring input field...');
                        return getInputField(page, currentInputSelector);
                    }
                    return currentInputField;
                });
                inputField = refreshedField;

                // Wait before clearing
                await wait(1000);

                // Clear the text area
                await clearInputField(page, inputSelector);
                await saveHTMLForDebug(page, `part-${i + 1}-cleared.html`, isDev);

                // Wait after clearing
                await wait(1000);

                // Input the string in the text area
                await inputString(page, inputSelector, part);
                await saveHTMLForDebug(page, `part-${i + 1}-input.html`, isDev);

                // Wait after input
                await wait(1000);

                const buttonSelector = await getButtonSelector(page);
                if (!buttonSelector) {
                    await saveHTMLForDebug(page, `part-${i + 1}-button-not-found.html`, isDev);
                    console.log('Button selector not found. Exiting script.');
                    return null;
                }

                const isSubmitted = await submitForm(page, buttonSelector);
                if (!isSubmitted) {
                    // Handle submission failure
                    await saveHTMLForDebug(page, `part-${i + 1}-submission-failed.html`, isDev);
                    console.log('Form submission failed. Exiting script.');
                    return null;
                }

                // Wait a bit for output to be ready
                await wait(2000);

                // Get the paraphrased content
                const outputContent = await getOutputContent(page, OUTPUT_SELECTOR);
                if (outputContent) {
                    output += `${outputContent} `;
                    await saveHTMLForDebug(page, `part-${i + 1}-completed.html`, isDev);
                } else {
                    // Handle the case where no output content is retrieved
                    await saveHTMLForDebug(page, `part-${i + 1}-no-output.html`, isDev);
                    console.log('Output content not found. Exiting script.');
                    return null;
                }

                console.log('Paraphrasing complete', i + 1, 'of', parts.length);

                // Wait before next iteration
                await wait(1000);
            } catch (error) {
                await saveHTMLForDebug(page, `part-${i + 1}-error.html`, isDev);
                console.error(`Error processing part ${i + 1}: ${error.message}`);
                throw error;
            }
        }

        console.log('Paraphrasing complete');
        const result = output.trim();
        // Store success flag to avoid delaying browser close on success
        // eslint-disable-next-line no-underscore-dangle, require-atomic-updates
        options._success = true;
        return result;
    } catch (error) {
        console.error(`Error in paraphraser function: ${error.message}`);
        console.error(error.stack);
        // Save error state HTML if in dev mode
        const isDev = options.headless === false || options.headless === 'new';
        if (page && !page.isClosed?.()) {
            try {
                await saveHTMLForDebug(page, 'error-state.html', isDev);
            } catch (saveError) {
                console.error(`Could not save error HTML: ${saveError.message}`);
            }
        }
        return null;
    } finally {
        await closeBrowser(browser, options);
    }
}

module.exports = {
    paraphraser,
};

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

const TRANSLATOR_URL = 'https://quillbot.com/translate';
const OUTPUT_SELECTOR = '#tltr-output';

/**
 * Map language names to QuillBot language codes
 * @param {string} languageName - Language name (e.g., 'English (US)', 'Spanish')
 * @returns {string|null} Language code or null if not found
 */
function getLanguageCode(languageName) {
    const languageMap = {
        // English variants
        'English (US)': 'en-US',
        'English (UK)': 'en-GB',
        'English (AU)': 'en-AU',
        English: 'en-US',
        // Spanish
        Spanish: 'es',
        Español: 'es',
        // French
        French: 'fr',
        Français: 'fr',
        // German
        German: 'de',
        Deutsch: 'de',
        // Italian
        Italian: 'it',
        Italiano: 'it',
        // Portuguese
        Portuguese: 'pt',
        Português: 'pt',
        // Chinese
        Chinese: 'zh',
        中文: 'zh',
        // Japanese
        Japanese: 'ja',
        日本語: 'ja',
        // Korean
        Korean: 'ko',
        한국어: 'ko',
        // Russian
        Russian: 'ru',
        Русский: 'ru',
        // Auto-detect
        Auto: 'auto',
        auto: 'auto',
    };

    // Try exact match first
    if (languageMap[languageName]) {
        return languageMap[languageName];
    }

    // Try case-insensitive match
    const lowerName = languageName.toLowerCase();
    for (const [key, value] of Object.entries(languageMap)) {
        if (key.toLowerCase() === lowerName) {
            return value;
        }
    }

    // Try partial match
    for (const [key, value] of Object.entries(languageMap)) {
        if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
            return value;
        }
    }

    return null;
}

/**
 * Get the correct input selector for the translation tool
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<string|null>} CSS selector or null
 */
async function getInputSelector(page) {
    // Known working selector first for speed
    const inputSelectors = [
        '[data-testid="tltr-input-editor"]', // Primary selector from HTML
        '#editor',
        'div[contenteditable="true"][role="textbox"]',
        '[data-testid="tltr-input-editor"] div[contenteditable="true"]',
        'div[contenteditable="true"][translate="no"]',
        'div[contenteditable="true"]',
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
            }, 2, page);
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
 * Get the correct button selector for the translate button
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<string|null>} CSS selector or null
 */
async function getButtonSelector(page) {
    // Known working selector first for speed
    const buttonSelectors = [
        '[data-testid="tltr-translate-button"]', // Primary selector from HTML
        'button[data-testid="tltr-translate-button"]',
        'button[aria-label*="Translate"]',
        'button[aria-label*="Ctrl + Return"]',
        'button[aria-label*="Cmd + Return"]',
        '//button[contains(text(), "Translate")]',
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
 * Click the translate button
 * @param {Object} page - Puppeteer page object
 * @param {string} buttonSelector - CSS/XPath selector for the button
 * @returns {Promise<boolean>} True if clicked successfully
 */
async function clickTranslateButton(page, buttonSelector) {
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
        console.error(`Error clicking translate button: ${error.message}`);
        return false;
    }
}

/**
 * Wait for translation to complete
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<boolean>} True if translation completed
 */
async function waitForTranslation(page) {
    try {
        // Wait for output content to appear
        await safePageOperation(async () => {
            await page.waitForSelector(OUTPUT_SELECTOR, {
                visible: true,
                timeout: 30000,
            });
        });

        // Additional wait to ensure content is loaded
        await wait(2000);

        // Check if output has content
        const hasContent = await safePageOperation(async () => page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (!element) return false;
            const text = element.textContent || element.innerText || '';
            return text.trim().length > 0;
        }, OUTPUT_SELECTOR));

        if (!hasContent) {
            console.log('Output detected but appears empty, waiting longer...');
            await wait(3000);
        }

        return true;
    } catch (error) {
        console.error('Error: Translation did not complete in the expected time.');
        return false;
    }
}

/**
 * Submit the translation form
 * @param {Object} page - Puppeteer page object
 * @param {string} buttonSelector - CSS/XPath selector for the button
 * @returns {Promise<boolean>} True if submitted successfully
 */
async function submitForm(page, buttonSelector) {
    const isClicked = await clickTranslateButton(page, buttonSelector);
    if (!isClicked) {
        console.log('Failed to find and click the translate button.');
        return false;
    }

    const isSubmitted = await waitForTranslation(page);
    if (!isSubmitted) {
        return false;
    }

    return true;
}

/**
 * Select source language for translation
 * @param {Object} page - Puppeteer page object
 * @param {string} languageName - Name of the source language to select
 */
async function selectSourceLanguage(page, languageName) {
    try {
        await safePageOperation(async () => {
            // Click the source language button
            const sourceButton = await page.$('[data-testid="tltr-source-language-button"]');
            if (sourceButton) {
                await sourceButton.click();
            } else {
                throw new Error('Source language button not found');
            }
        });

        // Wait a moment for menu to appear
        await wait(1000);

        await safePageOperation(async () => {
            // Try multiple methods to find and click the language option
            // Method 1: XPath (if available)
            try {
                const languageOptionXPath = `//li//p[contains(text(), "${languageName}")] | //li//span[contains(text(), "${languageName}")] | //li[contains(., "${languageName}")]`;
                const languageOptions = await page.$x(languageOptionXPath);
                if (languageOptions.length > 0) {
                    await languageOptions[0].click();
                    console.log(`Source language set to "${languageName}".`);
                    return;
                }
            } catch (xpathError) {
                // XPath not available, try CSS selector method
            }

            // Method 2: CSS selector with text content check
            const languageSelected = await page.evaluate((langName) => {
                const menuItems = document.querySelectorAll('[role="menuitem"], li[role="option"], li[class*="MenuItem"]');
                for (const item of menuItems) {
                    const text = item.textContent || item.innerText || '';
                    if (text.includes(langName)) {
                        item.click();
                        return true;
                    }
                }
                return false;
            }, languageName);

            if (languageSelected) {
                console.log(`Source language set to "${languageName}".`);
            } else {
                throw new Error(`Source language option "${languageName}" not found.`);
            }
        });
    } catch (error) {
        console.error(`Error selecting source language "${languageName}": ${error.message}`);
        // Don't throw - language selection is optional
    }
}

/**
 * Select target language for translation
 * @param {Object} page - Puppeteer page object
 * @param {string} languageName - Name of the target language to select
 */
async function selectTargetLanguage(page, languageName) {
    try {
        await safePageOperation(async () => {
            // Click the target language button
            const targetButton = await page.$('[data-testid="tltr-target-language-button"]');
            if (targetButton) {
                await targetButton.click();
            } else {
                throw new Error('Target language button not found');
            }
        });

        // Wait a moment for menu to appear
        await wait(1000);

        await safePageOperation(async () => {
            // Try multiple methods to find and click the language option
            // Method 1: XPath (if available)
            try {
                const languageOptionXPath = `//li//p[contains(text(), "${languageName}")] | //li//span[contains(text(), "${languageName}")] | //li[contains(., "${languageName}")]`;
                const languageOptions = await page.$x(languageOptionXPath);
                if (languageOptions.length > 0) {
                    await languageOptions[0].click();
                    console.log(`Target language set to "${languageName}".`);
                    return;
                }
            } catch (xpathError) {
                // XPath not available, try CSS selector method
            }

            // Method 2: CSS selector with text content check
            const languageSelected = await page.evaluate((langName) => {
                const menuItems = document.querySelectorAll('[role="menuitem"], li[role="option"], li[class*="MenuItem"]');
                for (const item of menuItems) {
                    const text = item.textContent || item.innerText || '';
                    if (text.includes(langName)) {
                        item.click();
                        return true;
                    }
                }
                return false;
            }, languageName);

            if (languageSelected) {
                console.log(`Target language set to "${languageName}".`);
            } else {
                throw new Error(`Target language option "${languageName}" not found.`);
            }
        });
    } catch (error) {
        console.error(`Error selecting target language "${languageName}": ${error.message}`);
        // Don't throw - language selection is optional
    }
}

/**
 * Element check function for translation page
 * @returns {boolean} True if key elements are present
 */
function translatorElementCheck() {
    // Check for input editor
    const selectors = [
        '[data-testid="tltr-input-editor"]',
        '#editor',
        'div[contenteditable="true"][role="textbox"]',
        '[data-testid="tltr-input-editor"] div[contenteditable="true"]',
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
 * Translate text using QuillBot
 * @param {string} text - Text to translate
 * @param {Object} options - Options object
 * @param {boolean|string} options.headless - Browser headless mode (default: 'new')
 * @param {string} options.sourceLanguage - Source language (e.g., 'English (US)')
 * @param {string} options.targetLanguage - Target language (e.g., 'Spanish')
 * @returns {Promise<string|null>} Translated text or null on error
 */
async function translator(text, options = {}) {
    let browser;
    let page;
    try {
        const isDev = options.headless === false || options.headless === 'new';

        // Setup browser and page
        const {browser: browserInstance, page: pageInstance} = await setupBrowser(options);
        browser = browserInstance;
        page = pageInstance;

        console.log('Navigating to QuillBot Translator...');

        // Build URL with language parameters if provided
        let translatorUrl = TRANSLATOR_URL;
        const urlParams = new URLSearchParams();

        if (options.sourceLanguage) {
            const sourceCode = getLanguageCode(options.sourceLanguage);
            if (sourceCode) {
                urlParams.set('sl', sourceCode);
                console.log(`Setting source language via URL: ${options.sourceLanguage} -> ${sourceCode}`);
            }
        } else {
            urlParams.set('sl', 'auto'); // Default to auto-detect
        }

        if (options.targetLanguage) {
            const targetCode = getLanguageCode(options.targetLanguage);
            if (targetCode) {
                urlParams.set('tl', targetCode);
                console.log(`Setting target language via URL: ${options.targetLanguage} -> ${targetCode}`);
            }
        }

        if (urlParams.toString()) {
            translatorUrl += `?${urlParams.toString()}`;
        }

        await navigateToUrl(page, translatorUrl);

        // Wait for page initialization
        await waitForPageInitialization(page, translatorElementCheck);

        // Save initial HTML for debugging
        await saveHTMLForDebug(page, 'translator-initial-load.html', isDev);
        console.log('Initial page loaded and saved');

        // Select source language - non-blocking
        if (options.sourceLanguage) {
            console.log(`Attempting to select source language: ${options.sourceLanguage}`);
            try {
                await selectSourceLanguage(page, options.sourceLanguage);
                await wait(1000);
            } catch (error) {
                console.log(`Source language selection failed (continuing): ${error.message}`);
            }
        }

        // Select target language - non-blocking
        if (options.targetLanguage) {
            console.log(`Attempting to select target language: ${options.targetLanguage}`);
            try {
                await selectTargetLanguage(page, options.targetLanguage);
                await wait(1000);
            } catch (error) {
                console.log(`Target language selection failed (continuing): ${error.message}`);
            }
        }

        // Wait for input - try multiple times
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
                    await saveHTMLForDebug(page, `translator-retry-${retry + 1}-input-search.html`, isDev);
                }
            }
        }

        if (!inputField || !inputSelector) {
            await saveHTMLForDebug(page, 'translator-input-not-found.html', isDev);
            console.log('Input field not found. Exiting script.');
            console.log('Check debug-html/translator-input-not-found.html for page state');
            return null;
        }
        console.log('Input found');
        await saveHTMLForDebug(page, 'translator-before-translation.html', isDev);

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
            await saveHTMLForDebug(page, 'translator-cleared.html', isDev);

            // Wait after clearing
            await wait(1000);

            // Input the string in the text area
            await inputString(page, inputSelector, text);
            await saveHTMLForDebug(page, 'translator-input.html', isDev);

            // Wait after input for potential automatic translation
            await wait(2000);

            // Try to trigger translation - first try button click, then Enter key
            let translationTriggered = false;

            // Method 1: Try clicking the translate button
            const buttonSelector = await getButtonSelector(page);
            if (buttonSelector) {
                try {
                    const isSubmitted = await submitForm(page, buttonSelector);
                    if (isSubmitted) {
                        translationTriggered = true;
                        console.log('Translation triggered via button click.');
                    }
                } catch (buttonError) {
                    console.log(`Button click failed: ${buttonError.message}, trying Enter key...`);
                }
            }

            // Method 2: If button didn't work, try pressing Enter (Ctrl+Enter or just Enter)
            if (!translationTriggered) {
                try {
                    await safePageOperation(async () => {
                        await page.focus(inputSelector);
                        // Try Ctrl+Enter first (common shortcut for translate)
                        await page.keyboard.down('Control');
                        await page.keyboard.press('Enter');
                        await page.keyboard.up('Control');
                    });
                    await wait(1000);

                    // Check if translation happened
                    const hasOutput = await page.evaluate((selector) => {
                        const element = document.querySelector(selector);
                        if (!element) return false;
                        const elementText = element.textContent || element.innerText || '';
                        return elementText.trim().length > 0;
                    }, OUTPUT_SELECTOR);

                    if (hasOutput) {
                        translationTriggered = true;
                        console.log('Translation triggered via Ctrl+Enter.');
                    } else {
                        // Try just Enter
                        await page.keyboard.press('Enter');
                        await wait(1000);
                        console.log('Tried Enter key to trigger translation.');
                    }
                } catch (enterError) {
                    console.log(`Enter key method failed: ${enterError.message}`);
                }
            }

            // Wait for translation to complete (longer wait if we triggered it)
            if (translationTriggered) {
                await waitForTranslation(page);
            } else {
                // If no explicit trigger, wait longer for automatic translation
                console.log('Waiting for automatic translation...');
                await wait(5000);
            }

            // Get the translated content - try multiple selectors and methods
            let outputContent = await getOutputContent(page, OUTPUT_SELECTOR);

            // If output is same as input or empty, try alternative selectors
            if (!outputContent || outputContent.trim() === text.trim() || outputContent.trim().length === 0) {
                console.log('Primary output selector returned empty or same as input, trying alternatives...');

                // Try alternative output selectors
                const alternativeSelectors = [
                    '[data-testid="tltr-output-editor"]',
                    '#tltr-output div[contenteditable="true"]',
                    '#tltr-output .tiptap',
                    '[data-testid="tltr-output"]',
                ];

                for (const altSelector of alternativeSelectors) {
                    const altContent = await getOutputContent(page, altSelector);
                    if (altContent && altContent.trim() !== text.trim() && altContent.trim().length > 0) {
                        outputContent = altContent;
                        console.log(`Found output using alternative selector: ${altSelector}`);
                        break;
                    }
                }

                // If still no good output, try reading directly from the output element's inner structure
                if (!outputContent || outputContent.trim() === text.trim()) {
                    outputContent = await page.evaluate(() => {
                        const outputEl = document.querySelector('#tltr-output');
                        if (!outputEl) return null;

                        // Try to get text from various nested elements
                        const textElements = outputEl.querySelectorAll('p, span, div');
                        let bestText = '';
                        for (const el of textElements) {
                            const elText = el.textContent || el.innerText || '';
                            if (elText.trim().length > bestText.trim().length) {
                                bestText = elText;
                            }
                        }
                        return bestText || outputEl.textContent || outputEl.innerText || '';
                    });
                }
            }

            if (outputContent && outputContent.trim() !== text.trim() && outputContent.trim().length > 0) {
                await saveHTMLForDebug(page, 'translator-completed.html', isDev);
                const result = outputContent.trim();
                // Store success flag to avoid delaying browser close on success
                // eslint-disable-next-line no-underscore-dangle, require-atomic-updates
                options._success = true;
                return result;
            }

            // Handle the case where no output content is retrieved or output is same as input
            await saveHTMLForDebug(page, 'translator-no-output.html', isDev);
            console.log('Output content not found or translation did not occur. Exiting script.');
            console.log(`Input was: "${text}"`);
            console.log(`Output was: "${outputContent || '(empty)'}"`);
            return null;
        } catch (error) {
            await saveHTMLForDebug(page, 'translator-error.html', isDev);
            console.error(`Error processing translation: ${error.message}`);
            throw error;
        }
    } catch (error) {
        console.error(`Error in translator function: ${error.message}`);
        console.error(error.stack);
        // Save error state HTML if in dev mode
        const isDev = options.headless === false || options.headless === 'new';
        if (page && !page.isClosed?.()) {
            try {
                await saveHTMLForDebug(page, 'translator-error-state.html', isDev);
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
    translator,
};

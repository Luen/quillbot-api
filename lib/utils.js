const fs = require('fs');
const path = require('path');

const puppeteer = require('puppeteer');

/**
 * Helper function to safely execute page operations with retry
 * @param {Function} operation - The async operation to execute
 * @param {number} retries - Number of retry attempts (default: 3)
 * @param {Object} pageRef - Reference to the page object for validation
 * @returns {Promise} Result of the operation
 */
/**
 * Helper function to wait for a specified time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>} Promise that resolves after the wait time
 */
function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

async function safePageOperation(operation, retries = 3, pageRef = null) {
    let lastError = null;
    for (let i = 0; i < retries; i += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            // Check if it's a frame detachment or target closed error
            const isDetachedError = error.message.includes('detached')
                                   || error.message.includes('Target closed')
                                   || error.message.includes('Session closed')
                                   || error.message.includes('Protocol error')
                                   || error.message.includes('Navigating frame');

            if (isDetachedError && i < retries - 1) {
                // Wait progressively longer before retrying
                const waitTime = 2000 * (i + 1);
                console.log(`Frame detached, waiting ${waitTime}ms before retry ${i + 1}/${retries - 1}...`);
                await wait(waitTime);

                // Try to ensure page is still valid (but don't loop checking mainFrame)
                if (pageRef && typeof pageRef.url === 'function') {
                    try {
                        await pageRef.url(); // This will throw if page is truly invalid
                    } catch (urlError) {
                        console.error('Page is no longer valid, cannot retry');
                        throw new Error('Page is no longer accessible');
                    }
                }
                // Continue to next iteration
            } else {
                // If not a retryable error or out of retries, throw
                throw error;
            }
        }
    }
    // This should never be reached, but just in case
    throw lastError || new Error('Operation failed after retries');
}

/**
 * Function to save HTML for debugging
 * @param {Object} page - Puppeteer page object
 * @param {string} filename - Name of the file to save
 * @param {boolean} isDev - Whether in development mode
 */
async function saveHTMLForDebug(page, filename, isDev) {
    if (!isDev || !page) return; // Only save in dev mode and if page exists

    try {
        const html = await safePageOperation(async () => {
            try {
                return await page.content();
            } catch (error) {
                // If page is closed or frame detached, return null
                if (error.message.includes('Target closed')
                    || error.message.includes('detached')
                    || error.message.includes('Session closed')) {
                    return null;
                }
                throw error;
            }
        }, 1); // Only one retry for saving HTML - not critical

        if (!html) {
            // Page was closed or detached, can't save
            return;
        }

        const debugDir = path.join(process.cwd(), 'debug-html');
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, {recursive: true});
        }
        const filepath = path.join(debugDir, filename);
        fs.writeFileSync(filepath, html, 'utf8');
        console.log(`HTML saved to: ${filepath}`);
    } catch (error) {
        // Silently fail - HTML saving is not critical
        // Only log if it's not a known navigation/frame error
        if (!error.message.includes('Target closed')
            && !error.message.includes('detached')
            && !error.message.includes('Session closed')) {
            console.log(`Note: Could not save HTML ${filename}: ${error.message}`);
        }
    }
}

/**
 * Setup browser and page with error handling
 * @param {Object} options - Options object containing headless setting
 * @returns {Promise<Object>} Object containing browser and page
 */
async function setupBrowser(options = {}) {
    const isDev = options.headless === false || options.headless === 'new';

    if (typeof options.headless !== 'boolean') options.headless = 'new';
    const browser = await puppeteer.launch({
        headless: options.headless === 'new' ? false : options.headless,
    });

    const page = await browser.newPage();

    // Suppress console errors from Puppeteer - filter out known harmless errors
    page.on('console', (msg) => {
        const type = msg.type();
        const text = msg.text();
        // Skip known harmless errors
        const harmlessErrors = [
            'detached',
            'Navigating frame',
            'WebSocket connection',
            'ws://localhost',
            'ERR_CONNECTION_REFUSED',
            'FedCM',
            'GSI_LOGGER',
            'Not signed in with the identity provider',
            'Failed to load resource',
            'ERR_FAILED',
            '404',
        ];
        const isHarmless = harmlessErrors.some((pattern) => text.includes(pattern));
        // Only log errors that aren't harmless
        if (type === 'error' && !isHarmless) {
            console.log(`Browser console ${type}: ${text}`);
        }
    });

    // Suppress page error events that are just frame detachment warnings
    page.on('pageerror', (error) => {
        // Only log if it's not a detached frame error
        if (!error.message.includes('detached') && !error.message.includes('Navigating frame')) {
            console.error(`Page error: ${error.message}`);
        }
    });

    // Set a reasonable viewport
    await page.setViewport({width: 1920, height: 1080});

    return {browser, page, isDev};
}

/**
 * Navigate to a URL with proper error handling
 * @param {Object} page - Puppeteer page object
 * @param {string} url - URL to navigate to
 */
async function navigateToUrl(page, url) {
    // Navigate with proper wait conditions
    try {
        await page.goto(url, {
            waitUntil: 'domcontentloaded', // Use domcontentloaded instead of networkidle2 for more reliability
            timeout: 60000,
        });
    } catch (error) {
        // Ignore frame detachment errors during navigation - they're common with dynamic sites
        if (error.message.includes('detached') || error.message.includes('Navigating frame')) {
            console.log('Frame detachment during navigation (normal for dynamic sites), continuing...');
            // Wait a bit longer to ensure page is loaded despite the error
            await wait(5000);
        } else {
            // Re-throw other errors
            throw error;
        }
    }
}

/**
 * Wait for page to be fully initialized
 * @param {Object} page - Puppeteer page object
 * @param {Function} elementCheckFn - Function to check if key elements are present
 */
async function waitForPageInitialization(page, elementCheckFn) {
    console.log('Page loaded, waiting for initialization...');
    // Wait for page to fully initialize after navigation
    await wait(5000);

    // Ensure page is ready by checking if main frame is accessible
    try {
        const url = page.url();
        console.log(`Page URL: ${url}`);
    } catch (error) {
        console.error('Page appears to be in an invalid state after navigation');
        throw new Error('Page navigation failed - page is not accessible');
    }

    // Wait for the page to be fully interactive
    console.log('Waiting for page elements to load...');
    try {
        await page.waitForFunction(elementCheckFn, {timeout: 30000, polling: 500});
        console.log('Page elements detected');
    } catch (error) {
        console.log(`Page elements not detected within timeout: ${error.message}, continuing anyway...`);
    }

    // Additional wait for React/JavaScript to fully initialize
    console.log('Waiting for React to fully initialize...');
    await wait(5000);

    // Try to wait for any iframe navigations to complete
    console.log('Waiting for all frames to stabilize...');
    await wait(3000);

    // One more check - ensure page is still accessible after all the waiting
    try {
        await safePageOperation(async () => {
            const testUrl = page.url();
            console.log(`Page verified accessible: ${testUrl}`);
        }, 1);
    } catch (error) {
        console.error('Page became inaccessible after loading, retrying navigation...');
        // For now, continue and hope elements can still be found
    }
}

/**
 * Close browser with optional delay for debugging
 * @param {Object} browser - Puppeteer browser object
 * @param {Object} options - Options object containing headless and _success flags
 */
async function closeBrowser(browser, options = {}) {
    if (!browser) return;

    // Check if we're in dev mode (headless: false or 'new')
    const isDev = options.headless === false || options.headless === 'new';

    // Only delay browser close in dev mode if there was an error (not on success)
    // eslint-disable-next-line no-underscore-dangle
    if (isDev && !options._success) {
        // In dev mode with errors, keep browser open for debugging
        console.log('\n=== DEV MODE: Browser will stay open for 30 seconds for debugging ===');
        console.log('You can inspect the page to debug selectors and page structure.');
        console.log('Close the browser manually or wait for it to close automatically.\n');
        await wait(30000);
    }

    try {
        await browser.close();
    } catch (error) {
        console.error(`Error closing browser: ${error.message}`);
    }
}

/**
 * Get input content from an element
 * @param {Object} page - Puppeteer page object
 * @param {string} selector - CSS selector for the input element
 * @returns {Promise<string|null>} Input content or null
 */
async function getInputContent(page, selector) {
    try {
        return safePageOperation(async () => page.evaluate((sel) => {
            const inputElement = document.querySelector(sel);
            if (inputElement) {
                return inputElement.textContent || inputElement.value || '';
            }
            return null;
        }, selector));
    } catch (error) {
        console.error(`Error getting input content: ${error.message}`);
        return null;
    }
}

/**
 * Clear input field
 * @param {Object} page - Puppeteer page object
 * @param {string} inputSelector - CSS selector for the input field
 */
async function clearInputField(page, inputSelector) {
    try {
        // Click on the text area and press space bar first (this dismisses overlays and activates input)
        await safePageOperation(async () => {
            // Click on the input field
            await page.click(inputSelector, {clickCount: 1});
            await wait(200);

            // Press Ctrl+End to go to the very end of the text
            await page.keyboard.down('Control');
            await page.keyboard.press('End');
            await page.keyboard.up('Control');
            await wait(200);

            // Press space bar to dismiss any overlays
            await page.keyboard.press('Space');
            await wait(200);
        });

        // Clear the text area using JavaScript (most reliable)
        await safePageOperation(async () => {
            await page.evaluate((sel) => {
                const inputElement = document.querySelector(sel);
                if (inputElement) {
                    inputElement.focus();
                    inputElement.textContent = '';
                    if (inputElement.value !== undefined) {
                        inputElement.value = '';
                    }
                    // Trigger input event
                    const event = new Event('input', {bubbles: true});
                    inputElement.dispatchEvent(event);
                }
            }, inputSelector);
        });

        // Additional step to ensure complete clearing using keyboard commands
        await safePageOperation(async () => {
            await page.focus(inputSelector);
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
        });

        // Wait a moment to ensure clearing is complete
        await wait(300);
    } catch (error) {
        console.error(`Error clearing input field: ${error.message}`);
    }
}

/**
 * Input text into field
 * @param {Object} page - Puppeteer page object
 * @param {string} inputSelector - CSS selector for the input field
 * @param {string} text - Text to input
 */
async function inputString(page, inputSelector, text) {
    try {
        // Step 1: Update the text box content first (using JavaScript)
        console.log('Setting text content in input field...');
        await safePageOperation(async () => {
            await page.evaluate(
                (selector, textString) => {
                    const inputElement = document.querySelector(selector);
                    if (inputElement) {
                        inputElement.textContent = textString;
                        if (inputElement.value !== undefined) {
                            inputElement.value = textString;
                        }
                        // Trigger input events to notify the page
                        const events = ['input', 'change', 'keyup'];
                        events.forEach((eventType) => {
                            const event = new Event(eventType, {bubbles: true});
                            inputElement.dispatchEvent(event);
                        });
                    }
                },
                inputSelector,
                text
            );
        });

        // Wait a moment for content to be set
        await wait(300);

        // Step 2: Click on the text area and press space bar to activate it
        await safePageOperation(async () => {
            // Click on the input field
            await page.click(inputSelector, {clickCount: 1});
        });
        await wait(300);
        await safePageOperation(async () => {
            // Press Ctrl+End to go to the very end of the text
            await page.keyboard.down('Control');
            await page.keyboard.press('End');
            await page.keyboard.up('Control');
        });
        await wait(200);
        await safePageOperation(async () => {
            // Press space bar to dismiss any overlays and activate the input
            await page.keyboard.press('Space');
        });
        await wait(300);

        // Verify the text was set correctly
        const inputContent = await getInputContent(page, inputSelector);
        if (inputContent && inputContent.trim().length >= text.trim().length * 0.9) {
            console.log(`Text content set successfully (${inputContent.trim().length} characters)`);
            return;
        }

        // Fallback: Try clipboard paste if JavaScript method didn't work
        console.warn('Warning: Text content may not have been set correctly, trying paste method...');
        try {
            await safePageOperation(async () => {
                await page.evaluate(async (textString) => {
                    // eslint-disable-next-line no-undef
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(textString);
                    }
                }, text);
                await page.focus(inputSelector);
                await page.keyboard.down('Control');
                await page.keyboard.press('KeyV');
                await page.keyboard.up('Control');
            });
            await wait(500);
            // Click and press space again after pasting
            await page.click(inputSelector, {clickCount: 1});
            await wait(200);
            await safePageOperation(async () => {
                // Press Ctrl+End to go to the very end of the text
                await page.keyboard.down('Control');
                await page.keyboard.press('End');
                await page.keyboard.up('Control');
            });
            await wait(200);
            await safePageOperation(async () => {
                // Press space bar to dismiss any overlays
                await page.keyboard.press('Space');
            });
            await wait(200);
        } catch (error) {
            console.log(`Paste fallback failed: ${error.message}`);
        }
    } catch (error) {
        console.error(`Error inputting string: ${error.message}`);
        throw error;
    }
}

/**
 * Get output content from an element
 * @param {Object} page - Puppeteer page object
 * @param {string} selector - CSS selector for the output element
 * @returns {Promise<string|null>} Output content or null
 */
async function getOutputContent(page, selector) {
    try {
        const content = await safePageOperation(async () => page.evaluate((sel) => {
            const element = document.querySelector(sel);
            if (element) {
                return element.textContent || element.innerText || '';
            }
            return null;
        }, selector));

        if (content === null || content.trim() === '') {
            console.log('Output element not found or no content.');
            return null;
        }

        return content.trim();
    } catch (error) {
        console.error(`Error retrieving output content: ${error.message}`);
        return null;
    }
}

module.exports = {
    safePageOperation,
    saveHTMLForDebug,
    setupBrowser,
    navigateToUrl,
    waitForPageInitialization,
    closeBrowser,
    getInputContent,
    clearInputField,
    inputString,
    getOutputContent,
    wait,
};

const puppeteer = require('puppeteer')
const fs = require('fs')
const path = require('path')

function truncate(str, n) {
    if (str.length <= n) {
        return str
    }
    const regex = new RegExp(`\\b[\\w']+(?:[^\\w\\n]+[\\w']+){0,${n}}\\b`, 'g')
    const subString = str.match(regex) // split up text into n words
    return subString[0].slice(0, subString[0].lastIndexOf('.') + 1) // find nearest end of sentence
}

// Function to save HTML for debugging
async function saveHTMLForDebug(page, filename, isDev) {
    if (!isDev || !page) return // Only save in dev mode and if page exists
    
    try {
        const html = await safePageOperation(async () => {
            try {
                return await page.content()
            } catch (error) {
                // If page is closed or frame detached, return null
                if (error.message.includes('Target closed') || 
                    error.message.includes('detached') ||
                    error.message.includes('Session closed')) {
                    return null
                }
                throw error
            }
        }, 1) // Only one retry for saving HTML - not critical
        
        if (!html) {
            // Page was closed or detached, can't save
            return
        }
        
        const debugDir = path.join(process.cwd(), 'debug-html')
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, { recursive: true })
        }
        const filepath = path.join(debugDir, filename)
        fs.writeFileSync(filepath, html, 'utf8')
        console.log(`HTML saved to: ${filepath}`)
    } catch (error) {
        // Silently fail - HTML saving is not critical
        // Only log if it's not a known navigation/frame error
        if (!error.message.includes('Target closed') && 
            !error.message.includes('detached') &&
            !error.message.includes('Session closed')) {
            console.log(`Note: Could not save HTML ${filename}: ${error.message}`)
        }
    }
}

// Helper function to safely execute page operations with retry
async function safePageOperation(operation, retries = 3, pageRef = null) {
    let lastError = null
    for (let i = 0; i < retries; i++) {
        try {
            return await operation()
        } catch (error) {
            lastError = error
            // Check if it's a frame detachment or target closed error
            const isDetachedError = error.message.includes('detached') || 
                                   error.message.includes('Target closed') ||
                                   error.message.includes('Session closed') ||
                                   error.message.includes('Protocol error') ||
                                   error.message.includes('Navigating frame')
            
            if (isDetachedError && i < retries - 1) {
                // Wait progressively longer before retrying
                const waitTime = 2000 * (i + 1)
                console.log(`Frame detached, waiting ${waitTime}ms before retry ${i + 1}/${retries - 1}...`)
                await new Promise(resolve => setTimeout(resolve, waitTime))
                
                // Try to ensure page is still valid (but don't loop checking mainFrame)
                if (pageRef && typeof pageRef.url === 'function') {
                    try {
                        await pageRef.url() // This will throw if page is truly invalid
                    } catch (urlError) {
                        console.error('Page is no longer valid, cannot retry')
                        throw new Error('Page is no longer accessible')
                    }
                }
                continue
            }
            // If not a retryable error or out of retries, throw
            throw error
        }
    }
    // This should never be reached, but just in case
    throw lastError || new Error('Operation failed after retries')
}

// Function to get the correct input selector
async function getInputSelector(page) {
    const placeholderText =
        'To rewrite text, enter or paste it here and press "Paraphrase."'
    // Try multiple possible selectors for the input field on the paraphrasing tool page
    const inputSelectors = [
        '#inputText',
        '#paraphraser-input-box',
        '[data-testid="input-text-box"]',
        '[data-testid="paraphraser-input-box"]',
        'textarea[placeholder*="paste" i]',
        'textarea[placeholder*="Paraphrase" i]',
        'div[contenteditable="true"][placeholder*="paste" i]',
        'div[contenteditable="true"][placeholder*="Paste" i]',
        'div[placeholder*="paste" i]',
        `div[placeholder="${placeholderText}"]`,
        '[aria-label*="paste" i]',
        '[aria-label*="input" i]',
        '.paraphraser-input-box',
        '[role="textbox"]',
    ]

    for (const selector of inputSelectors) {
        try {
            const exists = await safePageOperation(async () => {
                // Try using page.$ directly first (simpler, less prone to frame issues)
                const element = await page.$(selector)
                if (!element) return false
                
                // Check if element is visible and interactive
                const isVisible = await page.evaluate((sel) => {
                    const el = document.querySelector(sel)
                    if (!el) return false
                    const rect = el.getBoundingClientRect()
                    const style = window.getComputedStyle(el)
                    return (
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        el.offsetParent !== null &&
                        rect.width > 0 &&
                        rect.height > 0
                    )
                }, selector)
                return isVisible
            }, 2, page) // Reduced retries to avoid long waits
            if (exists) {
                console.log(`Found input selector: ${selector}`)
                return selector // Return the selector if found
            }
        } catch (error) {
            // Continue to next selector - don't log every failure
            if (!error.message.includes('detached')) {
                // Only log non-detached errors
            }
            continue
        }
    }

    console.error('Error: Unable to find a valid input selector.')
    return null // Return null if no valid selector is found
}

// Function to get the input field using the provided selector
async function getInputField(page, inputSelector) {
    if (!inputSelector) {
        return null // Return null if the inputSelector is not provided
    }

    try {
        const input = await safePageOperation(async () => {
            return await page.waitForSelector(inputSelector, {
                visible: true,
                timeout: 10000,
            })
        })
        return input // Return the input field if found
    } catch (error) {
        console.error(
            `Error: Unable to find the input field with the selector: ${inputSelector}`
        )
        return null // Return null if the input field is not found
    }
}

// Function to clear the input field
async function clearInputField(page, inputSelector, inputField) {
    try {
        // Click on the text area and press space bar first (this dismisses overlays and activates input)
        await safePageOperation(async () => {
            // Click on the input field
            await page.click(inputSelector, { clickCount: 1 })
            await new Promise(resolve => setTimeout(resolve, 200))
            
            // Press Ctrl+End to go to the very end of the text
            await page.keyboard.down('Control')
            await page.keyboard.press('End')
            await page.keyboard.up('Control')
            await new Promise(resolve => setTimeout(resolve, 200))
            
            // Press space bar to dismiss any overlays
            await page.keyboard.press('Space')
            await new Promise(resolve => setTimeout(resolve, 200))
        })

        // Clear the text area using keyboard commands (most reliable)
        await safePageOperation(async () => {
            await page.evaluate((selector) => {
                const inputElement = document.querySelector(selector)
                if (inputElement) {
                    inputElement.focus()
                    inputElement.textContent = ''
                    if (inputElement.value !== undefined) {
                        inputElement.value = '' // Clear value for input elements
                    }
                    // Trigger input event
                    const event = new Event('input', { bubbles: true })
                    inputElement.dispatchEvent(event)
                }
            }, inputSelector)
        })

        // Additional step to ensure complete clearing using keyboard commands
        await safePageOperation(async () => {
            await page.focus(inputSelector)
            await page.keyboard.down('Control')
            await page.keyboard.press('KeyA')
            await page.keyboard.up('Control')
            await page.keyboard.press('Backspace') // Using 'Backspace' instead of 'Delete' for broader compatibility
        })

        // Wait a moment to ensure clearing is complete
        await new Promise(resolve => setTimeout(resolve, 300))
    } catch (error) {
        console.error(`Error clearing input field: ${error.message}`)
    }
}

// Function to get inputContent
async function getInputContent(page, inputSelector) {
    try {
        return await safePageOperation(async () => {
            return await page.evaluate((selector) => {
                const inputElement = document.querySelector(selector)
                if (inputElement) {
                    return inputElement.textContent || inputElement.value || ''
                }
                return null
            }, inputSelector)
        })
    } catch (error) {
        console.error(`Error getting input content: ${error.message}`)
        return null
    }
}

// Function to input text into the specified field
async function inputString(page, inputSelector, inputField, text) {
    try {
        // Step 1: Update the text box content first (using JavaScript)
        console.log('Setting text content in input field...')
        await safePageOperation(async () => {
            await page.evaluate(
                (selector, textString) => {
                    const inputElement = document.querySelector(selector)
                    if (inputElement) {
                        inputElement.textContent = textString
                        if (inputElement.value !== undefined) {
                            inputElement.value = textString
                        }
                        // Trigger input events to notify the page
                        const events = ['input', 'change', 'keyup']
                        events.forEach(eventType => {
                            const event = new Event(eventType, { bubbles: true })
                            inputElement.dispatchEvent(event)
                        })
                    }
                },
                inputSelector,
                text
            )
        })

        // Wait a moment for content to be set
        await new Promise(resolve => setTimeout(resolve, 300))

        // Step 2: Click on the text area and press space bar to activate it
        // This dismisses overlays and makes the paraphrase button clickable
        await safePageOperation(async () => {
            // Click on the input field
            await page.click(inputSelector, { clickCount: 1 })
            await new Promise(resolve => setTimeout(resolve, 300))
            
            // Press Ctrl+End to go to the very end of the text
            await page.keyboard.down('Control')
            await page.keyboard.press('End')
            await page.keyboard.up('Control')
            await new Promise(resolve => setTimeout(resolve, 200))
            
            // Press space bar to dismiss any overlays and activate the input
            await page.keyboard.press('Space')
            await new Promise(resolve => setTimeout(resolve, 300))
        })

        // Verify the text was set correctly
        let inputContent = await getInputContent(page, inputSelector)
        if (inputContent && inputContent.trim().length >= text.trim().length * 0.9) {
            console.log(`Text content set successfully (${inputContent.trim().length} characters)`)
        } else {
            console.warn('Warning: Text content may not have been set correctly, trying paste method...')
            // Fallback: Try clipboard paste if JavaScript method didn't work
            try {
                await safePageOperation(async () => {
                    await page.evaluate(async (textString) => {
                        // eslint-disable-next-line no-undef
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(textString)
                        }
                    }, text)
                    await page.focus(inputSelector)
                    await page.keyboard.down('Control')
                    await page.keyboard.press('KeyV')
                    await page.keyboard.up('Control')
                })
                await new Promise(resolve => setTimeout(resolve, 500))
                // Click and press space again after pasting
                await page.click(inputSelector, { clickCount: 1 })
                await new Promise(resolve => setTimeout(resolve, 200))
                // Press Ctrl+End to go to the very end of the text
                await page.keyboard.down('Control')
                await page.keyboard.press('End')
                await page.keyboard.up('Control')
                await new Promise(resolve => setTimeout(resolve, 200))
                // Press space bar to dismiss any overlays
                await page.keyboard.press('Space')
                await new Promise(resolve => setTimeout(resolve, 200))
            } catch (error) {
                console.log(`Paste fallback failed: ${error.message}`)
            }
        }
    } catch (error) {
        console.error(`Error inputting string: ${error.message}`)
        throw error
    }
}

// Function to get the correct button selector
async function getButtonSelector(page) {
    // Updated selectors based on actual HTML structure
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
    ]

    for (const selector of buttonSelectors) {
        try {
            let exists = await safePageOperation(async () => {
                if (selector.startsWith('//')) {
                    // XPath selector
                    const elements = await page.$x(selector)
                    return elements.length > 0
                } else {
                    // CSS selector
                    return (await page.$(selector)) !== null
                }
            })
            if (exists) {
                return selector // Return the selector if found
            }
        } catch (error) {
            // Continue to next selector
            continue
        }
    }

    console.error('Error: Unable to find a valid button selector.')
    return null // Return null if no valid selector is found
}

// Function to click the appropriate button
async function clickParaphraseButton(page, buttonSelector) {
    if (!buttonSelector) {
        return false // Return false if the buttonSelector is not provided
    }

    try {
        await safePageOperation(async () => {
            let button
            if (buttonSelector.startsWith('//')) {
                // XPath selector
                const buttons = await page.$x(buttonSelector)
                button = buttons[0]
            } else {
                // CSS selector
                button = await page.$(buttonSelector)
            }

            if (button) {
                await button.click()
                return true
            }
            return false
        })
        return true
    } catch (error) {
        console.error(`Error clicking paraphrase button: ${error.message}`)
        return false
    }
}

// Function to check if the form is submitted
async function waitForFormSubmission(page, buttonSelector) {
    try {
        // Wait for paraphrasing to complete
        // Try multiple approaches to detect when paraphrasing is done
        
        // Approach 1: Wait for loading indicator to appear and disappear
        try {
            await safePageOperation(async () => {
                await page.waitForSelector(`${buttonSelector} div:nth-child(2)`, {
                    visible: true,
                    timeout: 5000,
                })
            })
            
            await safePageOperation(async () => {
                await page.waitForSelector(`${buttonSelector} div:nth-child(2)`, {
                    hidden: true,
                    timeout: 30000,
                })
            })
            return true
        } catch (error) {
            // If that doesn't work, try waiting for output to appear
            console.log('Waiting for output to appear instead...')
        }

        // Approach 2: Wait for output content to appear
        try {
            await safePageOperation(async () => {
                await page.waitForSelector('#paraphraser-output-box', {
                    visible: true,
                    timeout: 30000,
                })
            })
            
            // Additional wait to ensure content is loaded
            await new Promise(resolve => setTimeout(resolve, 2000))
            return true
        } catch (error) {
            console.error('Error: Process did not complete in the expected time.')
            return false
        }
    } catch (error) {
        console.error(`Error waiting for form submission: ${error.message}`)
        return false
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
    const isClicked = await clickParaphraseButton(page, buttonSelector)
    if (!isClicked) {
        console.log('Failed to find and click the paraphrase button.')
        return false
    }

    const isSubmitted = await waitForFormSubmission(page, buttonSelector)
    if (!isSubmitted) {
        return false
    }

    return true
}

// Function to get the output content
async function getOutputContent(page, outputSelector) {
    try {
        const content = await safePageOperation(async () => {
            return await page.evaluate((selector) => {
                const element = document.querySelector(selector)
                if (element) {
                    return element.textContent || element.innerText || ''
                }
                return null
            }, outputSelector)
        })

        if (content === null || content.trim() === '') {
            console.log('Output element not found or no content.')
            return null
        }

        return content.trim()
    } catch (error) {
        console.error(`Error retrieving output content: ${error.message}`)
        return null
    }
}

async function selectLanguage(page, languageName) {
    // XPath to find a button with the text "All"
    const menuButtonXPath = "//button[contains(., 'All')]"

    try {
        await safePageOperation(async () => {
            // Check if page.$x is available (might not be if page is in bad state)
            if (typeof page.$x !== 'function') {
                throw new Error('Page.$x is not available - page may be in invalid state')
            }
            // Wait for the button to be visible and click it
            const menuButtons = await page.$x(menuButtonXPath)
            if (menuButtons.length > 0) {
                await menuButtons[0].click()
            } else {
                throw new Error('Language menu button not found')
            }
        })

        // Wait a moment for animation if needed
        await new Promise(resolve => setTimeout(resolve, 500))

        await safePageOperation(async () => {
            // XPath to find a language option by its text content
            const languageOptionXPath = `//li//p[contains(text(), "${languageName}")]`

            // Wait for the language option to be visible and click it
            if (typeof page.$x !== 'function') {
                throw new Error('Page.$x is not available - page may be in invalid state')
            }
            const languageOptions = await page.$x(languageOptionXPath)
            if (languageOptions.length > 0) {
                await languageOptions[0].click()
                console.log(`Language set to "${languageName}".`)
            } else {
                throw new Error(`Language option "${languageName}" not found.`)
            }
        })
    } catch (error) {
        console.error(`Error selecting language "${languageName}": ${error.message}`)
        // Don't throw - language selection is optional
    }
}
async function selectMode(page, modeName) {
    // Map mode names to their data-testid values
    const modeTestIds = {
        'Standard': 'pphr/header/modes/standard',
        'Fluency': 'pphr/header/modes/fluency',
        'Humanize': 'pphr/header/modes/natural',
        'Natural': 'pphr/header/modes/natural',
        'Formal': 'pphr/header/modes/formal',
        'Academic': 'pphr/header/modes/academic',
        'Simple': 'pphr/header/modes/simple',
        'Creative': 'pphr/header/modes/creative',
        'Expand': 'pphr/header/modes/expand',
        'Shorten': 'pphr/header/modes/shorten',
        'Custom': 'pphr/header/modes/custom',
    }

    // Normalize mode name (capitalize first letter)
    const normalizedModeName = modeName.charAt(0).toUpperCase() + modeName.slice(1)
    const testId = modeTestIds[normalizedModeName] || modeTestIds[modeName]

    if (!testId) {
        console.log(`Mode "${modeName}" not recognized. Available modes: ${Object.keys(modeTestIds).join(', ')}`)
        return
    }

    try {
        await safePageOperation(async () => {
            // Wait for the mode button with the specific data-testid
            const selector = `[data-testid="${testId}"]`
            await page.waitForSelector(selector, { visible: true, timeout: 10000 })
            await page.click(selector)
        })

        // Wait for mode selection to complete
        await new Promise(resolve => setTimeout(resolve, 500))

        console.log(`Mode set to "${modeName}".`)
    } catch (error) {
        console.log(`Error while selecting mode "${modeName}": ${error.message}`)
        // Don't throw - mode selection is optional
    }
}

async function selectSynonymsLevel(page, value) {
    // Ensure the value is within the allowed range
    const sanitizedValue = Math.max(0, Math.min(parseInt(value, 10) || 0, 100)) // Assuming the range is 0 to 100

    try {
        const result = await safePageOperation(async () => {
            // JavaScript code to be executed in the page context
            return await page.evaluate((sanitizedValue) => {
                // Find the slider by its unique characteristics
                const slider = document.querySelector(
                    'input[type="range"][data-testid="synonyms-slider"]'
                )
                if (slider) {
                    // Set the value of the slider
                    slider.value = sanitizedValue

                    // Dispatch events to notify the page of the change
                    const events = ['change', 'input'] // Add any other events the slider might listen to
                    events.forEach((event) => {
                        slider.dispatchEvent(new Event(event, { bubbles: true }))
                    })

                    return 'Success'
                } else {
                    return 'Slider not found'
                }
            }, sanitizedValue)
        })

        console.log(result) // Logs 'Success' if the slider was found and adjusted, otherwise 'Slider not found'
    } catch (error) {
        console.error(`Error setting synonyms level: ${error.message}`)
    }
}

async function quillbot(text, options = {}) {
    let browser // Declare browser outside of try-catch so it's accessible in finally
    let page
    try {
        const outputSelector = '#paraphraser-output-box'

        const numberOfCharacters = 125
        let str = text.trim()
        const parts = []
        let output = ''

        // 125 words per paraphrase for a free account
        // So break up the text into parts of 125 words
        if (str.match(/(\w+)/g).length > numberOfCharacters) {
            while (str.match(/(\w+)/g).length > numberOfCharacters) {
                const part = truncate(str, numberOfCharacters).trim()
                str = str.slice(part.length)
                parts.push(part)
            }
            parts.push(str.trim())
        } else {
            parts.push(str)
        }

        // Determine if we're in dev mode (headless is false or 'new')
        const isDev = options.headless === false || options.headless === 'new'
        
        if (typeof options.headless !== 'boolean') options.headless = 'new' // Set headless if not specified
        browser = await puppeteer.launch({
            headless: options.headless === 'new' ? false : options.headless,
        })

        page = await browser.newPage()
        
        // Suppress console errors from Puppeteer about detached frames
        page.on('console', (msg) => {
            const type = msg.type()
            const text = msg.text()
            // Only log non-detached frame errors
            if (type === 'error' && !text.includes('detached') && !text.includes('Navigating frame')) {
                console.log(`Browser console ${type}: ${text}`)
            }
        })
        
        // Suppress page error events that are just frame detachment warnings
        page.on('pageerror', (error) => {
            // Only log if it's not a detached frame error
            if (!error.message.includes('detached') && !error.message.includes('Navigating frame')) {
                console.error(`Page error: ${error.message}`)
            }
        })
        
        // Set a reasonable viewport
        await page.setViewport({ width: 1920, height: 1080 })
        
        console.log('Navigating to QuillBot Paraphrasing Tool...')
        // Navigate to QuillBot paraphrasing tool with proper wait conditions
        // Wrap in try-catch to handle frame detachment errors during navigation
        try {
            await page.goto('https://quillbot.com/paraphrasing-tool', { 
                waitUntil: 'domcontentloaded', // Use domcontentloaded instead of networkidle2 for more reliability
                timeout: 60000 
            })
        } catch (error) {
            // Ignore frame detachment errors during navigation - they're common with dynamic sites
            if (error.message.includes('detached') || error.message.includes('Navigating frame')) {
                console.log('Frame detachment during navigation (normal for dynamic sites), continuing...')
                // Wait a bit longer to ensure page is loaded despite the error
                await new Promise(resolve => setTimeout(resolve, 5000))
            } else {
                // Re-throw other errors
                throw error
            }
        }
        
        console.log('Page loaded, waiting for initialization...')
        // Wait for page to fully initialize after navigation
        // This gives time for any dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 5000))
        
        // Ensure page is ready by checking if main frame is accessible
        try {
            const url = page.url()
            console.log(`Page URL: ${url}`)
        } catch (error) {
            console.error('Page appears to be in an invalid state after navigation')
            throw new Error('Page navigation failed - page is not accessible')
        }
        
        // Wait for the page to be fully interactive
        // Try to wait for key elements that should be present on the paraphrasing page
        console.log('Waiting for page elements to load...')
        try {
            // Wait for either the input box or a common container element
            await page.waitForFunction(() => {
                // Check multiple possible selectors
                const selectors = [
                    '#inputText',
                    '#paraphraser-input-box',
                    '[data-testid="input-text-box"]',
                    '[data-testid="paraphraser-input-box"]',
                    'textarea[placeholder*="paste" i]',
                    'div[contenteditable="true"][placeholder*="paste" i]',
                    'div[placeholder*="paste" i]',
                    '[aria-label*="paste" i]',
                ]
                
                for (const selector of selectors) {
                    const element = document.querySelector(selector)
                    if (element) {
                        // Check if visible
                        const style = window.getComputedStyle(element)
                        if (style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null) {
                            return true
                        }
                    }
                }
                return false
            }, { timeout: 30000, polling: 500 })
            console.log('Page elements detected')
        } catch (error) {
            console.log(`Page elements not detected within timeout: ${error.message}, continuing anyway...`)
        }
        
        // Additional wait for React/JavaScript to fully initialize
        // QuillBot uses React which needs time to hydrate and render
        console.log('Waiting for React to fully initialize...')
        await new Promise(resolve => setTimeout(resolve, 5000))
        
        // Try to wait for any iframe navigations to complete
        // Some sites use iframes that navigate after page load
        console.log('Waiting for all frames to stabilize...')
        await new Promise(resolve => setTimeout(resolve, 3000))
        
        // Save initial HTML for debugging
        await saveHTMLForDebug(page, 'initial-load.html', isDev)
        console.log('Initial page loaded and saved')
        
        // One more check - ensure page is still accessible after all the waiting
        try {
            await safePageOperation(async () => {
                const testUrl = await page.url()
                console.log(`Page verified accessible: ${testUrl}`)
            }, 1)
        } catch (error) {
            console.error('Page became inaccessible after loading, retrying navigation...')
            // If page is no longer accessible, we have a problem
            // For now, continue and hope elements can still be found
        }

        // Select language before paraphrasing - non-blocking, continue if it fails
        if (options.language) {
            console.log(`Attempting to select language: ${options.language}`)
            try {
                await selectLanguage(page, options.language)
                await new Promise(resolve => setTimeout(resolve, 1000))
            } catch (error) {
                console.log(`Language selection failed (continuing): ${error.message}`)
            }
        }
        // Select mode before paraphrasing - non-blocking
        if (options.mode) {
            console.log(`Attempting to select mode: ${options.mode}`)
            try {
                await selectMode(page, options.mode)
                await new Promise(resolve => setTimeout(resolve, 1000))
            } catch (error) {
                console.log(`Mode selection failed (continuing): ${error.message}`)
            }
        }

        // Select synonyms level before paraphrasing - non-blocking
        if (options.synonymsLevel) {
            console.log(`Attempting to set synonyms level: ${options.synonymsLevel}`)
            try {
                await selectSynonymsLevel(page, options.synonymsLevel)
                await new Promise(resolve => setTimeout(resolve, 1000))
            } catch (error) {
                console.log(`Synonyms level setting failed (continuing): ${error.message}`)
            }
        }

        // Wait for input - try multiple times with fresh page references
        let inputSelector = null
        let inputField = null
        let retries = 3
        
        for (let retry = 0; retry < retries; retry++) {
            try {
                inputSelector = await getInputSelector(page)
                if (inputSelector) {
                    inputField = await getInputField(page, inputSelector)
                    if (inputField) {
                        break
                    }
                }
            } catch (error) {
                console.log(`Attempt ${retry + 1} failed to find input: ${error.message}`)
                if (retry < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000))
                    await saveHTMLForDebug(page, `retry-${retry + 1}-input-search.html`, isDev)
                }
            }
        }
        
        if (!inputField || !inputSelector) {
            // Handle the case where the input field wasn't found
            await saveHTMLForDebug(page, 'input-not-found.html', isDev)
            console.log('Input field not found. Exiting script.')
            console.log('Check debug-html/input-not-found.html for page state')
            // Browser will stay open in finally block if in dev mode
            return null // Exit the function, browser will be closed in finally
        }
        console.log('Input found')
        await saveHTMLForDebug(page, 'before-paraphrasing.html', isDev)

        // Go through each part and paraphrase it
        for (let i = 0; i < parts.length; i += 1) {
            console.log('Paraphrasing part', i + 1, 'of', parts.length)

            const part = parts[i]

            try {
                // Refresh page references if needed
                await safePageOperation(async () => {
                    if (!inputField || !await page.$(inputSelector)) {
                        console.log('Re-acquiring input field...')
                        inputField = await getInputField(page, inputSelector)
                    }
                })

                // Wait before clearing
                await new Promise((resolve) => setTimeout(resolve, 1000))

                // Clear the text area
                await clearInputField(page, inputSelector, inputField)
                await saveHTMLForDebug(page, `part-${i + 1}-cleared.html`, isDev)

                // Wait after clearing
                await new Promise((resolve) => setTimeout(resolve, 1000))

                // Input the string in the text area
                await inputString(page, inputSelector, inputField, part)
                await saveHTMLForDebug(page, `part-${i + 1}-input.html`, isDev)

                // Wait after input
                await new Promise((resolve) => setTimeout(resolve, 1000))

                const buttonSelector = await getButtonSelector(page)
                if (!buttonSelector) {
                    await saveHTMLForDebug(page, `part-${i + 1}-button-not-found.html`, isDev)
                    console.log('Button selector not found. Exiting script.')
                    return null
                }

                const isSubmitted = await submitForm(page, buttonSelector)
                if (!isSubmitted) {
                    // Handle submission failure
                    await saveHTMLForDebug(page, `part-${i + 1}-submission-failed.html`, isDev)
                    console.log('Form submission failed. Exiting script.')
                    return null
                }

                // Wait a bit for output to be ready
                await new Promise((resolve) => setTimeout(resolve, 2000))

                // Get the paraphrased content
                const outputContent = await getOutputContent(page, outputSelector)
                if (outputContent) {
                    output += outputContent + ' '
                    await saveHTMLForDebug(page, `part-${i + 1}-completed.html`, isDev)
                } else {
                    // Handle the case where no output content is retrieved
                    await saveHTMLForDebug(page, `part-${i + 1}-no-output.html`, isDev)
                    console.log('Output content not found. Exiting script.')
                    return null
                }

                console.log('Paraphrasing complete', i + 1, 'of', parts.length)

                // Wait before next iteration
                await new Promise((resolve) => setTimeout(resolve, 1000))
            } catch (error) {
                await saveHTMLForDebug(page, `part-${i + 1}-error.html`, isDev)
                console.error(`Error processing part ${i + 1}: ${error.message}`)
                throw error
            }
        }

        console.log('Paraphrasing complete')
        const result = output.trim()
        // Store success flag to avoid delaying browser close on success
        options._success = true
        return result
    } catch (error) {
        console.error(`Error in quillbot function: ${error.message}`)
        console.error(error.stack)
        // Save error state HTML if in dev mode
        const isDev = options.headless === false || options.headless === 'new'
        if (page && !page.isClosed?.()) {
            try {
                await saveHTMLForDebug(page, 'error-state.html', isDev)
            } catch (saveError) {
                console.error(`Could not save error HTML: ${saveError.message}`)
            }
        }
        // Browser will stay open in finally block if in dev mode
        return null
    } finally {
        if (browser) {
            // Check if we're in dev mode (headless: false or 'new')
            const isDev = options.headless === false || options.headless === 'new'
            
            // Only delay browser close in dev mode if there was an error (not on success)
            if (isDev && !options._success) {
                // In dev mode with errors, keep browser open for debugging
                console.log('\n=== DEV MODE: Browser will stay open for 30 seconds for debugging ===')
                console.log('You can inspect the page to debug selectors and page structure.')
                console.log('Close the browser manually or wait for it to close automatically.\n')
                await new Promise(resolve => setTimeout(resolve, 30000))
            }
            
            try {
                await browser.close()
            } catch (error) {
                console.error(`Error closing browser: ${error.message}`)
            }
        }
    }
}

exports.quillbot = quillbot

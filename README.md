# QuillBot API

[QuillBot](https://quillbot.com/) is an AI article rewriter/spinner and translator. This script uses Chrome Headless Browser via Puppeteer to interact with QuillBot to rephrase and translate text.

QuillBot no longer has an official API, so this is an unofficial implementation using web scraping via Puppeteer.

Note that this is a learning project, and I'm a hobbyist programmer.

## Features

### Supported Features

- **Text Paraphrasing**: Rephrase or rewrite articles or sentences using QuillBot's paraphrasing capabilities.
- **Text Translation**: Translate text between multiple languages using QuillBot's translation tool.
- **Batch Processing**: Break down and paraphrase texts longer than the word limit by processing them in parts.
- **Language Selection**: Choose the language for paraphrasing (e.g., English (AU), English (UK), etc.).
- **Modes**: Modes are settings that change what the AI focuses on in your text. Some modes make more changes than others or influence length. Available modes include: Standard, Fluency, Humanize/Natural, Formal, Academic, Simple, Creative, Expand, Shorten, and Custom.
- **Synonym Slider**: The Synonym Slider directly affects how many words are replaced with synonyms in your text. You can adjust the slider to have more or fewer words changed (0, 50, or 100).
- **Headless Browser Automation**: Automated text input and extraction using Puppeteer with a Chrome Headless Browser.
- **Automatic Translation**: Translation can be triggered automatically via URL parameters, with fallback to button click if needed.

### Not Supported (yet)

- User Login: The script does not support user authentication or logging into a QuillBot account.
- Premium Features: Access to premium features of QuillBot is not available. The script only uses the free services offered by QuillBot.
- Options to edit output (colors indicate a variety of changes and selections that relate to other controls such as rephrasing and thesaurus, synonyms, etc.)
- Various other settings (gear icon on right), such as the English dialect, contraction usage, and paraphrasing of quotations
- Detect when you've reached your daily limit.

## Installation

Install via npm:

```bash
npm install quillbot-api
```

Or via yarn:

```bash
yarn add quillbot-api
```

This will install Puppeteer and any other dependencies.

## Usage

### Paraphrasing

```javascript
const {paraphraser} = require('./index');

const text = 'Your text to paraphrase here...';

const options = {
    headless: false,        // default 'new' (shows browser)
    language: 'English (AU)', // default 'English (UK)'
    mode: 'Fluency',        // default 'Standard'
    synonymsLevel: '0',     // default '50' (options: '0', '50', '100')
};

const paraphrased = await paraphraser(text, options);
console.log(paraphrased);
```

### Translation

```javascript
const {translator} = require('./index');

const text = 'Hello, how are you today?';

const options = {
    headless: false,              // default 'new' (shows browser)
    sourceLanguage: 'English (US)', // optional - defaults to 'auto'
    targetLanguage: 'Spanish',     // required
    tone: 'auto',                  // optional - defaults to 'auto'
};

const translated = await translator(text, options);
console.log(translated);
```

### Options / Parameters

#### Paraphrasing Options

- `headless` (boolean|string): Browser headless mode. Use `false` or `'new'` to show browser (default: `'new'`)
- `language` (string): Language for paraphrasing (e.g., `'English (AU)'`, `'English (UK)'`, `'English (US)'`)
- `mode` (string): Paraphrasing mode. Options: `'Standard'`, `'Fluency'`, `'Humanize'`/`'Natural'`, `'Formal'`, `'Academic'`, `'Simple'`, `'Creative'`, `'Expand'`, `'Shorten'`, `'Custom'`
- `synonymsLevel` (string): Synonym slider level. Options: `'0'`, `'50'`, `'100'` (default: `'50'`)

#### Translation Options

- `headless` (boolean|string): Browser headless mode. Use `false` or `'new'` to show browser (default: `'new'`)
- `sourceLanguage` (string): Source language (e.g., `'English (US)'`, `'Spanish'`, `'French'`). Optional - defaults to auto-detect
- `targetLanguage` (string): Target language (e.g., `'Spanish'`, `'French'`, `'German'`). Required
- `tone` (string): Translation tone. Options: `'auto'`, `'formal'`, `'informal'` (default: `'auto'`)

## Run Example Script

```bash
node example.js
```

This will run both paraphrasing and translation examples.

## Example Code

### Complete Example

```javascript
const {paraphraser, translator} = require('./index');

(async () => {
    // Example 1: Paraphrasing
    const paragraph = 'TCP is a connection-oriented protocol...';
    
    const paraphraserOptions = {
        headless: false,
        language: 'English (AU)',
        mode: 'Fluency',
        synonymsLevel: '0',
    };
    
    const paraphrased = await paraphraser(paragraph, paraphraserOptions);
    console.log('Paraphrased:', paraphrased);
    
    // Example 2: Translation
    const textToTranslate = 'Hello, how are you today?';
    
    const translatorOptions = {
        headless: false,
        sourceLanguage: 'English (US)',
        targetLanguage: 'Spanish',
    };
    
    const translated = await translator(textToTranslate, translatorOptions);
    console.log('Translated:', translated);
})();
```

## Disclaimer

This script is primarily for educational and experimental purposes. Please keep in mind the ethical implications and QuillBot's terms of service when using this script for paraphrasing or translating content.

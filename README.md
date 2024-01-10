# Quillbot

 [Quillbot](https://quillbot.com/) is an AI article rewriter/spinner. This script uses Chrome Headless Browser via Puppeteer to interact with Quillbot to rephrase (plagiarise) text.
Quillbot no longer has an API, so this is the slow scraping method using Puppeteer.

Note that this is a learning project for myself, and I'm a hobbyist programmer.

# Features
## Supported Features:
- Text Paraphrasing: Rephrase or rewrite articles or sentences using Quillbot's basic free paraphrasing capabilities.
- Batch Processing: Break down and paraphrase texts longer than the word limit by processing them in parts.
- Headless Browser Automation: Automated text input and extraction using Puppeteer with a Chrome Headless Browser.

## Not Supported:
- User Login: The script does not support user authentication or logging into a Quillbot account.
- Premium Features: Access to premium features of Quillbot is not available. The script only uses the free services offered by Quillbot.
- Modes and other settings.
- Detect when you've reached your daily limit.

# Install

```
git clone https://github.com/Luen/quillbot-api
npm install
```

# Run example script

`node example`


# Example code

```
const { quillbot } = require('./index');

(async () => {
  const paragraph = 'TCP is a connection-oriented protocol, which means that the end-to-end communications is set up using handshaking. Once the connection is set up, user data may be sent bi-directionally over the connection. Compared to TCP, UDP is a simpler message based connectionless protocol, which means that the end-to-end connection is not dedicated and information is transmitted in one direction from the source to its destination without verifying the readiness or state of the receiver. TCP controls message acknowledgment, retransmission and timeout. TCP makes multiple attempts to deliver messages that get lost along the way, In TCP therefore, there is no missing data, and if ever there are multiple timeouts, the connection is dropped. When a UDP message is sent there is no guarantee that the message it will reach its destination; it could get lost along the way.';
  const paraphrased = await quillbot(paragraph);

  console.log('Before:');
  console.log(paragraph);
  console.log('Paraphrased:');
  console.log(paraphrased);
})();
```

# Note
This script is primarily for educational and experimental purposes. Please keep in mind the ethical implications and Quillbot's terms of service when using this script for paraphrasing content.

# Contributing
I want you to know that contributions to improve this script are welcome. Please fork the repository and submit a pull request with your changes.

# License
This project is licensed under the MIT License - see the LICENSE file for details.

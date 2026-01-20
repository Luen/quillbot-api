const {paraphraser, translator} = require('./index');

(async () => {
    // Example 1: Paraphrasing
    console.log('=== Example 1: Paraphrasing ===\n');
    const paragraph = 'TCP is a connection-oriented protocol, which means that the end-to-end communications is set up using handshaking. Once the connection is set up, user data may be sent bi-directionally over the connection. Compared to TCP, UDP is a simpler message based connectionless protocol, which means that the end-to-end connection is not dedicated and information is transmitted in one direction from the source to its destination without verifying the readiness or state of the receiver. TCP controls message acknowledgment, retransmission and timeout. TCP makes multiple attempts to deliver messages that get lost along the way, In TCP therefore, there is no missing data, and if ever there are multiple timeouts, the connection is dropped. When a UDP message is sent there is no guarantee that the message it will reach its destination; it could get lost along the way.';

    const paraphraserOptions = {
        headless: false, // default 'new'
        language: 'English (AU)', // default 'English (UK)'
        mode: 'Fluency', // default 'Standard'
        synonymsLevel: '0', // default '50' other options are '0' or '100' (slider percentage)
    };

    const paraphrased = await paraphraser(paragraph, paraphraserOptions);

    console.log('Before:');
    console.log(paragraph);
    console.log('\nParaphrased:');
    console.log(paraphrased);
    console.log('\n');

    // Example 2: Translation
    console.log('=== Example 2: Translation ===\n');
    const textToTranslate = 'Hello, how are you today?';

    const translatorOptions = {
        headless: false, // default 'new'
        sourceLanguage: 'English (US)', // optional - defaults to auto-detect
        targetLanguage: 'Spanish', // required
    };

    const translated = await translator(textToTranslate, translatorOptions);

    console.log('Original:');
    console.log(textToTranslate);
    console.log('\nTranslated:');
    console.log(translated);
})();

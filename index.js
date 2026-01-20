const {paraphraser} = require('./lib/paraphraser');
const {translator} = require('./lib/translator');

// Export both functions for backward compatibility and new usage
exports.paraphraser = paraphraser;
exports.translator = translator;

// Export quillbot as alias for paraphraser for backward compatibility
exports.quillbot = paraphraser;

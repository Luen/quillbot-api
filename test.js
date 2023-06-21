const { quillbot } = require('./index');

(async () => {
  const test = await quillbot('TCP is a connection-oriented protocol, which means that the end-to-end communications is set up using handshaking. Once the connection is set up, user data may be sent bi-directionally over the connection. Compared to TCP, UDP is a simpler message based connectionless protocol, which means that the end-to-end connection is not dedicated and information is transmitted in one direction from the source to its destination without verifying the readiness or state of the receiver. TCP controls message acknowledgment, retransmission and timeout. TCP makes multiple attempts to deliver messages that get lost along the way, In TCP therefore, there is no missing data, and if ever there are multiple timeouts, the connection is dropped. When a UDP message is sent there is no guarantee that the message it will reach its destination; it could get lost along the way.');
  console.log(test);
})();

const HEADER_BODY_SIZE = 8;

// Packet lengths include the four-byte framing/security prefix. The body passed
// here starts at wire offset 4, immediately before the WYD packet header fields.
const CLIENT_REQUESTS = new Map([
  [0x20d, { name: "account-login", frameLength: 124 }],
  [0xfde, { name: "token", frameLength: 32 }],
  [0x7f00, { name: "caracatoa-create-character", frameLength: 36 }],
  [0x7f03, { name: "caracatoa-attribute-allocation", frameLength: 16 }],
  [0x7f05, { name: "caracatoa-skill-learn", frameLength: 16 }],
  [0x7f07, { name: "caracatoa-equipment-change", frameLength: 16 }],
  [0x7f0c, { name: "caracatoa-mount-action", frameLength: 52 }],
  [0x7f10, { name: "caracatoa-refinement-action", frameLength: 52 }],
  [0x7f12, { name: "caracatoa-stage-ritual", frameLength: 52 }],
  // Private Caracatoa market request: 12-byte body header plus bounded JSON.
  [0x7f22, { name: "caracatoa-player-shop-action", dynamicFrameLength: true }],
  [0x213, { name: "request-character-entry", frameLength: 36 }],
  [0x36c, { name: "world-move", frameLength: 52 }],
  [0x373, { name: "world-item-use", frameLength: 36 }],
  [0x39d, { name: "world-basic-attack", frameLength: 72 }],
  [0x3a0, { name: "world-keepalive", frameLength: 12 }],
]);

// Standard server-to-client sizes are copied from the WYDBot packet parsers.
// Private Caracatoa opcodes below use their own fixed synthetic contracts. Token
// responses are dispatched by opcode only; TCP still requires a 12-byte
// minimum frame and a valid checksum, but the application declares no exact
// token-response length.
const CLIENT_EXPECTED_RESPONSES = new Map([
  [0x105, { name: "server-message", frameLength: 16 }],
  [0x10a, { name: "login-successful", frameLength: 2808 }],
  [0x110, { name: "resend-character-list", frameLength: 1224 }],
  [0x114, { name: "character-to-world", frameLength: 2104 }],
  [0x181, { name: "compact-hp-mp-sync", frameLength: 20 }],
  [0x182, { name: "inventory-slot-delta", frameLength: 28 }],
  [0x364, { name: "create-mob", frameLength: 256 }],
  [0x366, { name: "world-move-response", frameLength: 52 }],
  [0x338, { name: "mob-death", frameLength: 32 }],
  [0x36a, { name: "mob-state-delta", frameLength: 20 }],
  [0x39d, { name: "single-attack-result", frameLength: 72 }],
  [0x7f01, { name: "caracatoa-create-character-result", frameLength: 16 }],
  [0x7f04, { name: "caracatoa-attribute-sync", frameLength: 52 }],
  [0x7f06, { name: "caracatoa-skill-state", frameLength: 36 }],
  [0x7f08, { name: "caracatoa-equipment-state", frameLength: 22 }],
  [0x7f09, { name: "caracatoa-skill-effect-result", frameLength: 36 }],
  [0x7f0a, { name: "caracatoa-itemization-detail", frameLength: 62 }],
  [0x7f0d, { name: "caracatoa-mount-state", frameLength: null }],
  [0x7f11, { name: "caracatoa-refinement-result", frameLength: 28 }],
  [0x7f13, { name: "caracatoa-stage-state", frameLength: 40 }],
  [0xfde, { name: "token-accepted", frameLength: null }],
  [0xfdf, { name: "token-incorrect", frameLength: null }],
]);

function asBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array)
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("packet body precisa ser Buffer ou Uint8Array.");
}

/** Inspect only the public WYD packet header; never return or log packet fields. */
export function inspectWyd727ClientFrame(input) {
  const body = asBytes(input);
  if (body.length < HEADER_BODY_SIZE) {
    return {
      recognized: false,
      malformed: true,
      reason: "packet shorter than WYD header",
    };
  }

  const opcode = body.readUInt16LE(0);
  const known = CLIENT_REQUESTS.get(opcode);
  const frameLength = body.length + 4;
  if (!known) {
    return { recognized: false, malformed: false, opcode, frameLength };
  }

  return {
    recognized: true,
    malformed: false,
    opcode,
    name: known.name,
    frameLength,
    ...(known.dynamicFrameLength
      ? {
          expectedFrameLength: null,
          lengthValid: frameLength >= 18 && frameLength <= 4112,
        }
      : {
          expectedFrameLength: known.frameLength,
          lengthValid: frameLength === known.frameLength,
        }),
  };
}

/** Inspect expected server-to-client shapes from the WYDBot public parsers.
 * This only validates synthetic fixtures; it does not implement a game reply.
 */
export function inspectWyd727ServerFrame(input) {
  const body = asBytes(input);
  if (body.length < HEADER_BODY_SIZE) {
    return {
      recognized: false,
      malformed: true,
      reason: "packet shorter than WYD header",
    };
  }

  const opcode = body.readUInt16LE(0);
  const known = CLIENT_EXPECTED_RESPONSES.get(opcode);
  const frameLength = body.length + 4;
  if (!known) {
    return { recognized: false, malformed: false, opcode, frameLength };
  }

  const lengthKnown = known.frameLength !== null;
  return {
    recognized: true,
    malformed: false,
    opcode,
    name: known.name,
    frameLength,
    expectedFrameLength: known.frameLength,
    lengthKnown,
    lengthValid: lengthKnown ? frameLength === known.frameLength : null,
  };
}

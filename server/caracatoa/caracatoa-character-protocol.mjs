export const CARACATOA_CREATE_CHARACTER_REQUEST_OPCODE = 0x7f00;
export const CARACATOA_CREATE_CHARACTER_RESULT_OPCODE = 0x7f01;
export const CARACATOA_CREATE_CHARACTER_REQUEST_LENGTH = 36;

export const CARACATOA_CREATE_CHARACTER_STATUS = Object.freeze({
  created: 0,
  invalidVersion: 1,
  invalidSlot: 2,
  invalidName: 3,
  duplicateName: 4,
  unsupportedClass: 5,
  accountLimit: 6,
  storageFailure: 7,
});

function isNameByte(byte) {
  return (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) || byte === 0x5f;
}

/** Parse the body returned by StreamDecoder (the four-byte frame prefix is absent). */
export function parseCaracatoaCreateCharacterRequest(input) {
  if (!(Buffer.isBuffer(input) || input instanceof Uint8Array)) {
    throw new TypeError('pacote de criação precisa ser Buffer ou Uint8Array.');
  }
  const body = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (body.length !== CARACATOA_CREATE_CHARACTER_REQUEST_LENGTH - 4 ||
      body.readUInt16LE(0) !== CARACATOA_CREATE_CHARACTER_REQUEST_OPCODE) {
    return { malformed: true };
  }

  const version = body.readUInt16LE(8);
  const slot = body.readUInt8(10);
  const classId = body.readUInt8(11);
  const nameLength = body.readUInt8(12);
  const nameBytes = body.subarray(14, 30);
  const reservedIsZero = body[13] === 0 && body[30] === 0 && body[31] === 0;

  let status = CARACATOA_CREATE_CHARACTER_STATUS.created;
  let name = '';
  if (version !== 1) {
    status = CARACATOA_CREATE_CHARACTER_STATUS.invalidVersion;
  } else if (slot > 3) {
    status = CARACATOA_CREATE_CHARACTER_STATUS.invalidSlot;
  } else if (classId > 3) {
    status = CARACATOA_CREATE_CHARACTER_STATUS.unsupportedClass;
  } else if (nameLength < 1 || nameLength > 16 || !reservedIsZero) {
    status = CARACATOA_CREATE_CHARACTER_STATUS.invalidName;
  } else {
    for (let i = 0; i < nameLength; i += 1) {
      if (!isNameByte(nameBytes[i])) {
        status = CARACATOA_CREATE_CHARACTER_STATUS.invalidName;
        break;
      }
    }
    for (let i = nameLength; i < nameBytes.length; i += 1) {
      if (nameBytes[i] !== 0) {
        status = CARACATOA_CREATE_CHARACTER_STATUS.invalidName;
        break;
      }
    }
    if (status === CARACATOA_CREATE_CHARACTER_STATUS.created) {
      name = nameBytes.subarray(0, nameLength).toString('ascii');
    }
  }

  return { malformed: false, status, slot, classId, name };
}

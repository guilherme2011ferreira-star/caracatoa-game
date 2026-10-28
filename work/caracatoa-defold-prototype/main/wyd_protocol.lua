local source_tables = require "main.protocol_tables"

local Protocol = {}

local HEADER_SIZE = 4
local MIN_FRAME_SIZE = 12
local MAX_FRAME_SIZE = 0xffff
local MAX_BUFFERED_BYTES = 1024 * 1024
local MAX_CONFIGURED_BUFFER = 16 * 1024 * 1024
local CLIENT_HANDSHAKE = string.char(0x11, 0xf3, 0x11, 0x1f)
local CHUNK_SIZE = 128
local unpack_values = unpack or table.unpack

local table_a = source_tables.table_a
local table_b = source_tables.table_b

local function is_byte_table(values)
	if type(values) ~= "table" or #values ~= 256 then
		return false
	end
	for index = 1, 256 do
		local value = values[index]
		if type(value) ~= "number" or value < 0 or value > 255 or value % 1 ~= 0 then
			return false
		end
	end
	return true
end

local function append_byte(chunks, batch, count, value)
	count = count + 1
	batch[count] = value
	if count == CHUNK_SIZE then
		chunks[#chunks + 1] = string.char(unpack_values(batch, 1, count))
		return {}, 0
	end
	return batch, count
end

local function flush_batch(chunks, batch, count)
	if count > 0 then
		chunks[#chunks + 1] = string.char(unpack_values(batch, 1, count))
	end
end

local function to_unsigned_byte(value)
	return value % 256
end

local function decode_byte(wire_value, key_value, position)
	local mode = position % 4
	if mode == 0 then
		return to_unsigned_byte(wire_value - key_value * 2)
	elseif mode == 1 then
		return to_unsigned_byte(wire_value + math.floor(key_value / 8))
	elseif mode == 2 then
		return to_unsigned_byte(wire_value - key_value * 4)
	end
	return to_unsigned_byte(wire_value + math.floor(key_value / 32))
end

local function encode_byte(plain_value, key_value, position)
	local mode = position % 4
	if mode == 0 then
		return to_unsigned_byte(plain_value + key_value * 2)
	elseif mode == 1 then
		return to_unsigned_byte(plain_value - math.floor(key_value / 8))
	elseif mode == 2 then
		return to_unsigned_byte(plain_value + key_value * 4)
	end
	return to_unsigned_byte(plain_value - math.floor(key_value / 32))
end

local function result_error(message)
	return { ok = false, error = message }
end

function Protocol.is_ready()
	return is_byte_table(table_a) and is_byte_table(table_b)
end

function Protocol.client_handshake()
	return CLIENT_HANDSHAKE
end

function Protocol.encode_frame(body, sequence)
	if not Protocol.is_ready() then
		return result_error("Tabelas do codec local inválidas.")
	end
	if type(body) ~= "string" then
		return result_error("O corpo precisa ser uma string binária.")
	end
	if type(sequence) ~= "number" or sequence % 1 ~= 0 or sequence < 0 or sequence > 0xff then
		return result_error("Sequência fora do intervalo de um byte.")
	end

	local frame_length = #body + HEADER_SIZE
	if frame_length < MIN_FRAME_SIZE or frame_length > MAX_FRAME_SIZE then
		return result_error("Tamanho de frame fora do perfil observado.")
	end

	local chunks = { string.char(frame_length % 256, math.floor(frame_length / 256), sequence, 0) }
	local batch = {}
	local batch_count = 0
	local initial_key = table_a[sequence + 1]
	local wire_sum = 0
	local plain_sum = 0
	for offset = 0, #body - 1 do
		local position = offset + HEADER_SIZE
		local key_index = ((initial_key + offset) % 256) + 1
		local plain_value = string.byte(body, offset + 1)
		local wire_value = encode_byte(plain_value, table_b[key_index], position)
		batch, batch_count = append_byte(chunks, batch, batch_count, wire_value)
		wire_sum = (wire_sum + wire_value) % 256
		plain_sum = (plain_sum + plain_value) % 256
	end
	flush_batch(chunks, batch, batch_count)
	chunks[1] = string.char(frame_length % 256, math.floor(frame_length / 256), sequence, (wire_sum - plain_sum) % 256)
	return { ok = true, wire = table.concat(chunks) }
end

function Protocol.decode_frame(wire)
	if not Protocol.is_ready() then
		return result_error("Tabelas do codec local inválidas.")
	end
	if type(wire) ~= "string" or #wire < HEADER_SIZE then
		return result_error("Frame menor que o cabeçalho.")
	end

	local declared_length = string.byte(wire, 1) + string.byte(wire, 2) * 256
	if declared_length ~= #wire then
		return result_error("Comprimento declarado não corresponde aos bytes recebidos.")
	end
	if declared_length < MIN_FRAME_SIZE or declared_length > MAX_FRAME_SIZE then
		return result_error("Comprimento de frame fora do intervalo.")
	end

	local sequence = string.byte(wire, 3)
	local initial_key = table_a[sequence + 1]
	local chunks = {}
	local batch = {}
	local batch_count = 0
	local wire_sum = 0
	local plain_sum = 0
	for offset = 0, #wire - HEADER_SIZE - 1 do
		local position = offset + HEADER_SIZE
		local key_index = ((initial_key + offset) % 256) + 1
		local wire_value = string.byte(wire, position + 1)
		local plain_value = decode_byte(wire_value, table_b[key_index], position)
		batch, batch_count = append_byte(chunks, batch, batch_count, plain_value)
		wire_sum = (wire_sum + wire_value) % 256
		plain_sum = (plain_sum + plain_value) % 256
	end
	flush_batch(chunks, batch, batch_count)
	if (wire_sum - plain_sum) % 256 ~= string.byte(wire, 4) then
		return result_error("Checksum de frame inválido.")
	end
	return { ok = true, sequence = sequence, body = table.concat(chunks) }
end

function Protocol.new_stream_decoder(options)
	options = options or {}
	local expect_handshake = options.expect_handshake == true
	local max_buffered_bytes = options.max_buffered_bytes or MAX_BUFFERED_BYTES
	if type(max_buffered_bytes) ~= "number" or max_buffered_bytes % 1 ~= 0 or
		max_buffered_bytes < MAX_FRAME_SIZE + #CLIENT_HANDSHAKE or
		max_buffered_bytes > MAX_CONFIGURED_BUFFER then
		return nil, "Limite de buffer fora do intervalo permitido."
	end
	return {
		buffer = "",
		failed = false,
		handshake_done = not expect_handshake,
		max_buffered_bytes = max_buffered_bytes,
	}
end

function Protocol.feed(decoder, incoming)
	if type(decoder) ~= "table" then
		return { ok = false, frames = {}, handshake_completed = false, error = "Decoder inválido." }
	end
	if decoder.failed then
		return { ok = false, frames = {}, handshake_completed = false, error = "Decoder em estado inválido." }
	end
	if type(incoming) ~= "string" then
		decoder.failed = true
		decoder.buffer = ""
		return { ok = false, frames = {}, handshake_completed = false, error = "Dados recebidos precisam ser string binária." }
	end
	if #incoming + #decoder.buffer > decoder.max_buffered_bytes then
		decoder.failed = true
		decoder.buffer = ""
		return { ok = false, frames = {}, handshake_completed = false, error = "Buffer de stream excedeu o limite." }
	end

	local data = decoder.buffer .. incoming
	local offset = 1
	local handshake_completed = false
	if not decoder.handshake_done then
		if #data < #CLIENT_HANDSHAKE then
			decoder.buffer = data
			return { ok = true, frames = {}, handshake_completed = false, error = "" }
		end
		if data:sub(1, #CLIENT_HANDSHAKE) ~= CLIENT_HANDSHAKE then
			decoder.failed = true
			decoder.buffer = ""
			return { ok = false, frames = {}, handshake_completed = false, error = "Handshake inicial inesperado." }
		end
		offset = #CLIENT_HANDSHAKE + 1
		decoder.handshake_done = true
		handshake_completed = true
	end

	local frames = {}
	while #data - offset + 1 >= 2 do
		local declared_length = string.byte(data, offset) + string.byte(data, offset + 1) * 256
		if declared_length < MIN_FRAME_SIZE then
			decoder.failed = true
			decoder.buffer = ""
			return { ok = false, frames = {}, handshake_completed = handshake_completed, error = "Comprimento de frame inválido no stream." }
		end
		if #data - offset + 1 < declared_length then
			break
		end
		local wire = data:sub(offset, offset + declared_length - 1)
		local decoded = Protocol.decode_frame(wire)
		if not decoded.ok then
			decoder.failed = true
			decoder.buffer = ""
			return { ok = false, frames = {}, handshake_completed = handshake_completed, error = decoded.error }
		end
		frames[#frames + 1] = decoded
		offset = offset + declared_length
	end
	decoder.buffer = data:sub(offset)
	return { ok = true, frames = frames, handshake_completed = handshake_completed, error = "" }
end

function Protocol.finish(decoder)
	if type(decoder) ~= "table" then
		return "Decoder inválido."
	end
	if decoder.failed then
		return "Decoder em estado inválido."
	end
	if not decoder.handshake_done then
		return "Stream terminou antes do handshake esperado."
	end
	if #decoder.buffer > 0 then
		return "Stream terminou com frame incompleto."
	end
	return ""
end

local function from_hex(value)
	if type(value) ~= "string" or #value % 2 ~= 0 or value:find("[^0-9a-fA-F]") then
		return nil
	end
	local chunks = {}
	for index = 1, #value, 2 do
		chunks[#chunks + 1] = string.char(tonumber(value:sub(index, index + 1), 16))
	end
	return table.concat(chunks)
end

function Protocol.run_self_test()
	if not Protocol.is_ready() then
		return false, "Tabelas de protocolo inválidas."
	end
	local fixtures = require "main.protocol_fixtures"
	for _, fixture in ipairs(fixtures.vectors) do
		local body = from_hex(fixture.body_hex)
		local expected_wire = from_hex(fixture.wire_hex)
		if not body or not expected_wire or #expected_wire ~= fixture.frame_length then
			return false, "Fixture Lua inválida: " .. tostring(fixture.name)
		end
		local encoded = Protocol.encode_frame(body, fixture.sequence)
		if not encoded.ok or encoded.wire ~= expected_wire then
			return false, "Encode divergiu do vetor: " .. tostring(fixture.name)
		end
		local decoded = Protocol.decode_frame(expected_wire)
		if not decoded.ok or decoded.sequence ~= fixture.sequence or decoded.body ~= body then
			return false, "Decode divergiu do vetor: " .. tostring(fixture.name)
		end
	end

	local first_wire = from_hex(fixtures.vectors[1].wire_hex)
	local second_wire = from_hex(fixtures.vectors[2].wire_hex)
	local third_wire = from_hex(fixtures.vectors[3].wire_hex)
	local decoder, decoder_error = Protocol.new_stream_decoder({ expect_handshake = true })
	if not decoder then
		return false, decoder_error
	end
	local partial_handshake = Protocol.feed(decoder, CLIENT_HANDSHAKE:sub(1, 2))
	if not partial_handshake.ok or partial_handshake.handshake_completed or #partial_handshake.frames ~= 0 then
		return false, "Handshake fragmentado falhou."
	end
	local partial_frame = Protocol.feed(decoder, CLIENT_HANDSHAKE:sub(3) .. first_wire:sub(1, 7))
	if not partial_frame.ok or not partial_frame.handshake_completed or #partial_frame.frames ~= 0 then
		return false, "Handshake com frame fragmentado falhou."
	end
	local coalesced = Protocol.feed(decoder, first_wire:sub(8) .. second_wire .. third_wire)
	if not coalesced.ok or #coalesced.frames ~= 3 then
		return false, "Frames fragmentados/coalescidos falharam."
	end
	if Protocol.finish(decoder) ~= "" then
		return false, "Decoder de stream não terminou vazio."
	end

	local corrupt = first_wire:sub(1, 3) .. string.char((string.byte(first_wire, 4) + 1) % 256) .. first_wire:sub(5)
	if Protocol.decode_frame(corrupt).ok then
		return false, "Checksum alterado foi aceito."
	end
	local too_short = string.char(11, 0, 0, 0) .. string.rep("\0", 7)
	if Protocol.decode_frame(too_short).ok or Protocol.encode_frame(string.rep("\0", 7), 0).ok then
		return false, "Tamanho menor que o mínimo foi aceito."
	end
	local maximum_body = string.rep("\90", MAX_FRAME_SIZE - HEADER_SIZE)
	local maximum_encoded = Protocol.encode_frame(maximum_body, 0x7e)
	if not maximum_encoded.ok or #maximum_encoded.wire ~= MAX_FRAME_SIZE then
		return false, "Frame no limite uint16 não foi codificado."
	end
	local maximum_decoded = Protocol.decode_frame(maximum_encoded.wire)
	if not maximum_decoded.ok or maximum_decoded.body ~= maximum_body then
		return false, "Frame no limite uint16 não foi decodificado."
	end
	if Protocol.encode_frame(string.rep("\0", MAX_FRAME_SIZE - HEADER_SIZE + 1), 0).ok then
		return false, "Frame maior que uint16 foi aceito."
	end
	local bounded, bounded_error = Protocol.new_stream_decoder({ max_buffered_bytes = MAX_FRAME_SIZE + #CLIENT_HANDSHAKE })
	if not bounded then
		return false, bounded_error
	end
	local overflow = Protocol.feed(bounded, string.rep("x", MAX_FRAME_SIZE + #CLIENT_HANDSHAKE + 1))
	if overflow.ok or not bounded.failed then
		return false, "Limite do buffer não foi aplicado."
	end
	return true, "Lua frame codec synthetic vectors passed."
end

return Protocol

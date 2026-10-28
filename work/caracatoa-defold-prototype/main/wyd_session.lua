local Session = {}
local json = require "json"

local U32_MODULUS = 4294967296
local CLINE_VERSION_BASE = 0xfb8c
local CLIENT_VERSION = 0x0c9c9301
local MOVE_DELTAS = {
	[0x31] = { x = -1, y = -1 },
	[0x32] = { x = 0, y = -1 },
	[0x33] = { x = 1, y = -1 },
	[0x34] = { x = -1, y = 0 },
	[0x36] = { x = 1, y = 0 },
	[0x37] = { x = -1, y = 1 },
	[0x38] = { x = 0, y = 1 },
	[0x39] = { x = 1, y = 1 },
}

local function is_integer(value)
	return type(value) == "number" and value == math.floor(value)
end

local function validate_range(value, minimum, maximum, label)
	if not is_integer(value) or value < minimum or value > maximum then
		error(label .. " fora do intervalo aceito.")
	end
end

local function validate_ascii(value, label)
	if type(value) ~= "string" then
		error(label .. " precisa conter apenas ASCII imprimível.")
	end
	for index = 1, #value do
		local byte = string.byte(value, index)
		if byte < 0x20 or byte > 0x7e then
			error(label .. " precisa conter apenas ASCII imprimível.")
		end
	end
end

local function write_u8(bytes, offset, value)
	validate_range(value, 0, 0xff, "UInt8")
	bytes[offset + 1] = value
end

local function write_u16(bytes, offset, value)
	validate_range(value, 0, 0xffff, "UInt16")
	bytes[offset + 1] = value % 256
	bytes[offset + 2] = math.floor(value / 256)
end

local function write_i16(bytes, offset, value)
	validate_range(value, -0x8000, 0x7fff, "Int16")
	write_u16(bytes, offset, value < 0 and value + 0x10000 or value)
end

local function write_u32(bytes, offset, value)
	validate_range(value, 0, 0xffffffff, "UInt32")
	for index = 0, 3 do
		bytes[offset + index + 1] = math.floor(value / (256 ^ index)) % 256
	end
end

local function write_i32(bytes, offset, value)
	validate_range(value, -0x80000000, 0x7fffffff, "Int32")
	write_u32(bytes, offset, value < 0 and value + U32_MODULUS or value)
end

local function write_bytes(bytes, offset, value, expected_length, label)
	if type(value) ~= "string" or #value ~= expected_length then
		error(label .. " precisa ter " .. expected_length .. " bytes.")
	end
	for index = 1, expected_length do
		bytes[offset + index] = string.byte(value, index)
	end
end

local function write_fixed_ascii(bytes, offset, value, field_length, label)
	validate_ascii(value, label)
	local count = math.min(#value, field_length - 1)
	for index = 1, count do
		bytes[offset + index] = string.byte(value, index)
	end
end

local function new_body(opcode, client_id, timestamp, body_length)
	validate_range(client_id, 0, 0xffff, "client ID")
	validate_range(timestamp, 0, 0xffffffff, "timestamp")
	local bytes = {}
	for index = 1, body_length do bytes[index] = 0 end
	write_u16(bytes, 0, opcode)
	write_u16(bytes, 2, client_id)
	write_u32(bytes, 4, timestamp)
	return bytes
end

local function to_binary(bytes)
	local chunks = {}
	for index = 1, #bytes do
		chunks[index] = string.char(bytes[index])
	end
	return table.concat(chunks)
end

local function read_u8(binary, offset)
	return string.byte(binary, offset + 1)
end

local function read_u16(binary, offset)
	return read_u8(binary, offset) + read_u8(binary, offset + 1) * 256
end

local function read_i16(binary, offset)
	local value = read_u16(binary, offset)
	return value >= 0x8000 and value - 0x10000 or value
end

local function read_u32(binary, offset)
	return read_u8(binary, offset) + read_u8(binary, offset + 1) * 256 +
		read_u8(binary, offset + 2) * 65536 + read_u8(binary, offset + 3) * 16777216
end

local function read_i32(binary, offset)
	local value = read_u32(binary, offset)
	return value >= 0x80000000 and value - U32_MODULUS or value
end

local function read_fixed_ascii(binary, offset, length)
	local value = binary:sub(offset + 1, offset + length)
	local terminator = value:find("\0", 1, true)
	return terminator and value:sub(1, terminator - 1) or value
end

local function read_header(binary, expected_length, expected_opcode)
	if type(binary) ~= "string" or #binary ~= expected_length then
		return nil, "Tamanho da resposta de sessão inválido."
	end
	local opcode = read_u16(binary, 0)
	if opcode ~= expected_opcode then
		return nil, "Opcode da resposta de sessão inesperado."
	end
	return {
		opcode = opcode,
		client_id = read_u16(binary, 2),
		timestamp = read_u32(binary, 4),
	}
end

function Session.compute_cline_version(shift)
	validate_range(shift, 1, 9, "shift do CLINE")
	return (shift + (CLINE_VERSION_BASE * (2 ^ shift)) * 10) % U32_MODULUS
end

function Session.is_valid_account_id(value)
	return type(value) == "string" and #value >= 1 and #value <= 15 and
		value:match("^[A-Za-z0-9][A-Za-z0-9._%-]*$") ~= nil
end

function Session.is_valid_login_password(value)
	if type(value) ~= "string" or #value < 1 or #value > 11 then return false end
	local ok = pcall(validate_ascii, value, "senha de login")
	return ok
end

function Session.build_account_login_body(options)
	options = options or {}
	local bytes = new_body(0x20d, options.client_id or 0, options.timestamp or 0, 120)
	write_fixed_ascii(bytes, 8, options.password or "", 12, "senha sintética/login")
	write_fixed_ascii(bytes, 20, options.account_id or "", 16, "ID da conta")
	write_u32(bytes, 88, options.client_version or CLIENT_VERSION)
	write_i32(bytes, 92, 1)
	write_bytes(bytes, 96, options.adapter_id or string.rep("\0", 16), 16, "adapter ID")
	write_bytes(bytes, 112, options.mac or string.rep("\0", 6), 6, "MAC")
	return to_binary(bytes)
end

function Session.build_token_body(options)
	options = options or {}
	local pin = options.pin or ""
	validate_ascii(pin, "PIN")
	if #pin < 4 or #pin > 6 or pin:find("[^0-9]") then
		error("PIN precisa conter de quatro a seis dígitos.")
	end
	local bytes = new_body(0xfde, options.client_id or 0, options.timestamp or 0, 28)
	for index = 1, #pin do bytes[8 + index] = string.byte(pin, index) end
	write_i32(bytes, 24, options.is_changing or 0)
	return to_binary(bytes)
end

function Session.build_character_entry_body(options)
	options = options or {}
	local slot = options.slot or 0
	validate_range(slot, 0, 3, "slot de personagem")
	local bytes = new_body(0x213, options.client_id or 0, options.timestamp or 0, 32)
	write_i32(bytes, 8, slot)
	write_u32(bytes, 16, Session.compute_cline_version(options.shift or 3))
	return to_binary(bytes)
end

function Session.build_keepalive_body(options)
	options = options or {}
	local bytes = new_body(0x3a0, options.mob_index or 0, options.timestamp or 0, 8)
	return to_binary(bytes)
end

function Session.build_move_body(options)
	options = options or {}
	local mob_index = options.mob_index or 0
	local position = options.position
	local direction_code = options.direction_code
	local delta = MOVE_DELTAS[direction_code]
	validate_range(mob_index, 1, 0xffff, "mobIndex")
	if type(position) ~= "table" then error("Posição de movimento inválida.") end
	validate_range(position.x, -0x8000, 0x7fff, "posição X")
	validate_range(position.y, -0x8000, 0x7fff, "posição Y")
	if not delta then error("Direção WYD inválida.") end
	local destination = { x = position.x + delta.x, y = position.y + delta.y }
	validate_range(destination.x, -0x8000, 0x7fff, "destino X")
	validate_range(destination.y, -0x8000, 0x7fff, "destino Y")
	local bytes = new_body(0x36c, mob_index, options.timestamp or 0, 48)
	write_i16(bytes, 8, position.x)
	write_i16(bytes, 10, position.y)
	write_u32(bytes, 12, 0)
	write_u32(bytes, 16, 7)
	write_u8(bytes, 20, direction_code)
	write_i16(bytes, 44, destination.x)
	write_i16(bytes, 46, destination.y)
	return to_binary(bytes)
end

function Session.build_single_target_skill_attack_body(options)
	options = options or {}
	local client_id = options.client_id or 0
	local target_mob_index = options.target_mob_index or 0
	local skill_id = options.skill_id or 0
	local source_position = options.source_position
	local target_position = options.target_position
	validate_range(client_id, 1, 0xffff, "client ID")
	validate_range(target_mob_index, 1, 0xffff, "alvo da habilidade")
	validate_range(skill_id, 1, 95, "ID da habilidade")
	if type(source_position) ~= "table" or type(target_position) ~= "table" then
		error("Posição do jogador ou do alvo inválida.")
	end
	for _, position in ipairs({ source_position, target_position }) do
		validate_range(position.x, 0, 0xffff, "coordenada de combate")
		validate_range(position.y, 0, 0xffff, "coordenada de combate")
	end
	local bytes = new_body(0x39d, client_id, options.timestamp or 0, 68)
	write_u16(bytes, 30, source_position.x)
	write_u16(bytes, 32, source_position.y)
	write_u16(bytes, 34, target_position.x)
	write_u16(bytes, 36, target_position.y)
	write_u16(bytes, 38, client_id)
	write_u8(bytes, 42, 0xff)
	write_i32(bytes, 48, -1)
	write_u16(bytes, 52, skill_id)
	write_u16(bytes, 56, target_mob_index)
	write_i32(bytes, 60, -1)
	return to_binary(bytes)
end

function Session.build_basic_attack_body(options)
	options = options or {}
	local client_id = options.client_id or 0
	local target_mob_index = options.target_mob_index or 0
	local source_position = options.source_position
	local target_position = options.target_position
	validate_range(client_id, 1, 0xffff, "client ID")
	validate_range(target_mob_index, 1, 0xffff, "alvo do ataque")
	if type(source_position) ~= "table" or type(target_position) ~= "table" then
		error("Posição do jogador ou do alvo inválida.")
	end
	local bytes = new_body(0x39d, client_id, options.timestamp or 0, 68)
	write_u16(bytes, 30, source_position.x)
	write_u16(bytes, 32, source_position.y)
	write_u16(bytes, 34, target_position.x)
	write_u16(bytes, 36, target_position.y)
	write_u16(bytes, 38, client_id)
	write_u8(bytes, 42, 4)
	write_i32(bytes, 48, 0)
	write_i16(bytes, 52, -1)
	write_u16(bytes, 56, target_mob_index)
	write_i32(bytes, 60, -2)
	return to_binary(bytes)
end

function Session.build_character_create_body(options)
	options = options or {}
	local slot = options.slot or 0
	local class_id = options.class_id or 0
	local name = options.name or ""
	validate_range(slot, 0, 3, "slot de personagem")
	validate_range(class_id, 0, 3, "classe Caracatoa")
	validate_range(options.client_id or 0, 1, 0xffff, "client ID")
	validate_ascii(name, "nome de personagem")
	if #name < 1 or #name > 16 or name:find("[^A-Za-z0-9_]") then
		error("nome precisa conter de 1 a 16 caracteres Caracatoa.")
	end
	local bytes = new_body(0x7f00, options.client_id, options.timestamp or 0, 32)
	write_u16(bytes, 8, 1)
	write_u8(bytes, 10, slot)
	write_u8(bytes, 11, class_id)
	write_u8(bytes, 12, #name)
	for index = 1, #name do bytes[14 + index] = string.byte(name, index) end
	return to_binary(bytes)
end

function Session.build_attribute_allocation_body(options)
	options = options or {}
	local client_id = options.client_id or 0
	local attribute_id = options.attribute_id or 0
	validate_range(client_id, 1, 0xffff, "client ID")
	validate_range(attribute_id, 0, 3, "ID de atributo")
	local bytes = new_body(0x7f03, client_id, options.timestamp or 0, 12)
	write_u8(bytes, 8, 1)
	write_u8(bytes, 9, attribute_id)
	write_u8(bytes, 10, 1)
	return to_binary(bytes)
end

function Session.parse_attribute_sync(body)
	local header, message = read_header(body, 48, 0x7f04)
	if not header then return nil, message end
	header.version = read_u8(body, 8)
	header.status = read_u8(body, 9)
	header.attribute_id = read_u8(body, 10)
	header.available_points = read_u32(body, 12)
	header.str = read_u16(body, 16)
	header.int = read_u16(body, 18)
	header.dex = read_u16(body, 20)
	header.con = read_u16(body, 22)
	header.current_hp = read_i32(body, 24)
	header.max_hp = read_i32(body, 28)
	header.current_mp = read_i32(body, 32)
	header.max_mp = read_i32(body, 36)
	header.damage = read_i32(body, 40)
	header.defense = read_i32(body, 44)
	if header.version ~= 1 or header.status > 3 or
		(header.status == 3 and header.attribute_id ~= 0xff) or
		(header.status ~= 3 and header.attribute_id > 3) or
		read_u8(body, 11) ~= 0 or header.current_hp < 0 or
		header.current_hp > header.max_hp or header.current_mp < 0 or
		header.current_mp > header.max_mp or header.damage < 0 or header.defense < 0 then
		return nil, "Snapshot de atributos fora do perfil Caracatoa."
	end
	return header
end

function Session.build_skill_learn_body(options)
	options = options or {}
	local client_id = options.client_id or 0
	local skill_id = options.skill_id or 0
	validate_range(client_id, 1, 0xffff, "client ID")
	validate_range(skill_id, 1, 95, "ID da habilidade")
	local bytes = new_body(0x7f05, client_id, options.timestamp or 0, 12)
	write_u8(bytes, 8, 1)
	write_u8(bytes, 9, skill_id)
	return to_binary(bytes)
end

function Session.parse_skill_state(body)
	local header, message = read_header(body, 32, 0x7f06)
	if not header then return nil, message end
	header.version = read_u8(body, 8)
	header.status = read_u8(body, 9)
	header.skill_id = read_u8(body, 10)
	header.available_points = read_u32(body, 12)
	header.learned_skills = {}
	if header.version ~= 1 or header.status > 7 or read_u8(body, 11) ~= 0 then
		return nil, "Ficha de habilidades fora do perfil Caracatoa."
	end
	if (header.status == 0 and header.skill_id ~= 0xff) or
		(header.status ~= 0 and (header.skill_id < 1 or header.skill_id > 95)) then
		return nil, "Resultado de aprendizado sem ID compatível."
	end
	for offset = 28, 31 do
		if read_u8(body, offset) ~= 0 then
			return nil, "Bytes reservados da ficha de habilidades não são zero."
		end
	end
	for skill_id = 1, 95 do
		local bit_index = skill_id - 1
		local byte_value = string.byte(body, 17 + math.floor(bit_index / 8)) or 0
		header.learned_skills[skill_id] = math.floor(byte_value / (2 ^ (bit_index % 8))) % 2 == 1
	end
	return header
end

function Session.build_equipment_change_body(options)
	options = options or {}
	local client_id = options.client_id or 0
	local equipment_slot = options.equipment_slot or 0
	local inventory_slot = options.inventory_slot
	validate_range(client_id, 1, 0xffff, "client ID")
	validate_range(equipment_slot, 0, 5, "slot de equipamento")
	if inventory_slot == nil then inventory_slot = 0xff end
	if inventory_slot ~= 0xff then validate_range(inventory_slot, 0, 59, "slot de inventário") end
	local bytes = new_body(0x7f07, client_id, 0, 12)
	write_u8(bytes, 4, equipment_slot)
	write_u8(bytes, 5, inventory_slot)
	write_u32(bytes, 6, options.timestamp or 0)
	return to_binary(bytes)
end

function Session.parse_equipment_state(body)
	local header, message = read_header(body, 18, 0x7f08)
	if not header then return nil, message end
	header.status = read_u8(body, 4)
	header.equipment_slot = read_u8(body, 5)
	header.inventory_slot = read_u8(body, 6)
	header.client_item_id = read_u16(body, 8)
	header.attack_bonus = read_u16(body, 10)
	header.defense_bonus = read_u16(body, 12)
	header.total_attack_bonus = read_u16(body, 14)
	header.total_defense_bonus = read_u16(body, 16)
	if header.status > 2 or header.equipment_slot > 5 or
		(header.inventory_slot > 59 and header.inventory_slot ~= 0xff) or
		((header.inventory_slot == 0xff) ~= (header.client_item_id == 0)) or
		(header.client_item_id == 0 and (header.attack_bonus ~= 0 or header.defense_bonus ~= 0)) then
		return nil, "Estado de equipamento fora do perfil Caracatoa."
	end
	return header
end

function Session.parse_progression_sync(body)
	local header, message = read_header(body, 44, 0x7f02)
	if not header then return nil, message end
	header.version = read_u8(body, 8)
	header.level = read_u32(body, 12)
	local experience_low = read_u32(body, 16)
	local experience_high = read_u32(body, 20)
	header.experience = experience_high * U32_MODULUS + experience_low
	header.current_hp = read_i32(body, 24)
	header.max_hp = read_i32(body, 28)
	header.current_mp = read_i32(body, 32)
	header.max_mp = read_i32(body, 36)
	header.damage = read_i32(body, 40)
	if header.version ~= 1 or read_u8(body, 9) ~= 0 or read_u8(body, 10) ~= 0 or read_u8(body, 11) ~= 0 or
		header.level < 1 or experience_high > 0x1fffff or
		header.max_hp < 1 or header.current_hp < 0 or header.current_hp > header.max_hp or
		header.max_mp < 0 or header.current_mp < 0 or header.current_mp > header.max_mp or header.damage < 0 then
		return nil, "Progressão da personagem fora do perfil Caracatoa."
	end
	return header
end

function Session.redact_request_body(opcode, body)
	if type(body) ~= "string" then return nil end
	if opcode == 0x20d and #body == 120 then
		return body:sub(1, 8) .. string.rep("\0", 28) .. body:sub(37, 96) .. string.rep("\0", 22) .. body:sub(119)
	end
	if opcode == 0xfde and #body == 28 then
		return body:sub(1, 8) .. string.rep("\0", 6) .. body:sub(15)
	end
	if opcode == 0x213 and #body == 32 then return body end
	if opcode == 0x7f00 and #body == 32 then return body end
	return nil
end

function Session.parse_login_success(body)
	local header, message = read_header(body, 2804, 0x10a)
	if not header then return nil, message end
	header.hash_key_table = body:sub(9, 24)
	header.selection = Session.parse_selection(body, 28)
	return header
end

function Session.new_request_sequence_state(hash_key_table)
	if type(hash_key_table) ~= "string" or #hash_key_table ~= 16 or string.byte(hash_key_table, 1) == 0 then
		return nil, "Tabela sintética de sequência inválida."
	end
	return { hash_key_table = hash_key_table, next_index = 1 }
end

function Session.next_request_sequence(state)
	if type(state) ~= "table" or type(state.hash_key_table) ~= "string" or #state.hash_key_table ~= 16 then
		return nil, "Estado de sequência inválido."
	end
	local sequence
	if state.next_index <= 16 then
		sequence = 0xff - string.byte(state.hash_key_table, state.next_index)
		state.next_index = state.next_index + 1
	else
		local keys = state.hash_key_table
		local hash
		if string.byte(keys, 16) % 2 == 0 then
			hash = string.byte(keys, 2) + string.byte(keys, 4) + string.byte(keys, 6) - 87
		else
			hash = string.byte(keys, 14) + string.byte(keys, 12) - string.byte(keys, 10) + 4
		end
		sequence = 0xff - (hash % 256)
	end
	return sequence
end

function Session.encode_next_request(Protocol, body, state)
	local sequence, message = Session.next_request_sequence(state)
	if sequence == nil then return nil, message end
	local encoded = Protocol.encode_frame(body, sequence)
	if not encoded.ok then return nil, encoded.error end
	return encoded
end

function Session.parse_token_result(body)
	if type(body) ~= "string" or #body ~= 8 then
		return nil, "Tamanho da resposta de PIN inválido."
	end
	local opcode = read_u16(body, 0)
	if opcode ~= 0xfde and opcode ~= 0xfdf then
		return nil, "Opcode da resposta de PIN inesperado."
	end
	return { opcode = opcode, accepted = opcode == 0xfde }
end

function Session.parse_character_create_result(body)
	local header, message = read_header(body, 12, 0x7f01)
	if not header then return nil, message end
	header.version = read_u8(body, 8)
	header.status = read_u8(body, 9)
	header.slot = read_u8(body, 10)
	header.class_id = read_u8(body, 11)
	if header.version ~= 1 or header.status > 7 or header.slot > 3 or header.class_id > 3 then
		return nil, "Resultado de criação fora do perfil Caracatoa."
	end
	return header
end

function Session.parse_selection(body, base_offset)
	base_offset = base_offset or 12
	if type(body) ~= "string" or #body < base_offset + 1208 then
		return nil, "Tabela de personagens incompleta."
	end
	local slots = {}
	for slot = 0, 3 do
		local name = read_fixed_ascii(body, base_offset + 16 + slot * 16, 16)
		local level = read_i32(body, base_offset + 80 + slot * 48)
		local class_wire = read_u16(body, base_offset + 272 + slot * 216)
		local class_id = math.floor(class_wire / 10)
		local gold = read_i32(body, base_offset + 1160 + slot * 4)
		if name ~= "" and class_id > 3 then
			return nil, "Classe de personagem fora do perfil Caracatoa."
		end
		slots[slot + 1] = {
			slot = slot,
			name = name,
			class_id = name ~= "" and class_id or nil,
			level = name ~= "" and level or nil,
			gold = name ~= "" and gold or nil,
		}
	end
	return slots
end

function Session.parse_character_roster(body)
	local header, message = read_header(body, 1220, 0x110)
	if not header then return nil, message end
	header.selection = Session.parse_selection(body, 12)
	return header
end

local INVENTORY_ITEM_OFFSET = 368
local INVENTORY_ITEM_STRIDE = 12
local INVENTORY_ITEM_COUNT = 60

local function parse_inventory_item(binary, offset)
	local client_item_id = read_u16(binary, offset)
	local stack_count = read_i16(binary, offset + 2)
	local field04 = read_u16(binary, offset + 4)
	if client_item_id == 0 then
		if stack_count ~= 0 then return nil, "Slot vazio com quantidade diferente de zero." end
		return nil
	end
	if stack_count < 1 or stack_count > 500 then
		return nil, "Quantidade do item fora do perfil Caracatoa."
	end
	local item = {
		client_item_id = client_item_id,
		stack_count = stack_count,
		field04 = field04,
		effects = {},
	}
	for index = 0, 2 do
		item.effects[index + 1] = {
			index = read_u8(binary, offset + 6 + index * 2),
			value = read_u8(binary, offset + 7 + index * 2),
		}
	end
	return item
end

function Session.parse_character_world(body)
	local header, message = read_header(body, 2100, 0x114)
	if not header then return nil, message end
	local class_id = read_u8(body, 32)
	local level = read_i32(body, 56) + 1
	local experience_low = read_u32(body, 44)
	local experience_high = read_u32(body, 48)
	local experience = experience_high * U32_MODULUS + experience_low
	if class_id > 3 or level < 1 or experience_high > 0x1fffff then
		return nil, "Ficha de personagem fora do perfil Caracatoa."
	end
	header.position = { x = read_i16(body, 8), y = read_i16(body, 10) }
	header.name = read_fixed_ascii(body, 12, 18)
	header.class_id = class_id
	header.level = level
	header.experience = experience
	header.gold = read_i32(body, 36)
	header.mob_index = read_u16(body, 1382)
	if header.mob_index == 0 then return nil, "Resposta de entrada sem mobIndex atribuído." end
	if header.name == "" then return nil, "Resposta de entrada sem nome de personagem." end
	header.inventory_items = {}
	for slot = 0, INVENTORY_ITEM_COUNT - 1 do
		local item, item_error = parse_inventory_item(body, INVENTORY_ITEM_OFFSET + slot * INVENTORY_ITEM_STRIDE)
		if item_error then return nil, item_error end
		if item then header.inventory_items[slot] = item end
	end
	return header
end

function Session.parse_inventory_slot_delta(body)
	local header, message = read_header(body, 24, 0x182)
	if not header then return nil, message end
	header.subtype = read_u16(body, 8)
	header.slot = read_i16(body, 10)
	if header.subtype ~= 1 or header.slot < 0 or header.slot >= INVENTORY_ITEM_COUNT then
		return nil, "Atualização de inventário fora do perfil Caracatoa."
	end
	local item, item_error = parse_inventory_item(body, 12)
	if item_error then return nil, item_error end
	header.item = item
	header.client_item_id = item and item.client_item_id or 0
	header.stack_count = item and item.stack_count or 0
	return header
end

function Session.parse_itemization_detail(body)
	local header, message = read_header(body, 58, 0x7f0a)
	if not header then return nil, message end
	header.version = read_u8(body, 8)
	header.status = read_u8(body, 9)
	header.slot = read_u8(body, 10)
	header.rarity_id = read_u8(body, 11)
	header.client_item_id = read_u16(body, 12)
	header.item_level = read_u16(body, 14)
	header.refinement_level = read_u8(body, 37)
	header.base_stats = {
		physical_damage = read_i32(body, 16),
		magic_attack = read_i32(body, 20),
		physical_defense = read_i32(body, 24),
		max_hp = read_i32(body, 28),
		max_mp = read_i32(body, 32),
	}
	local affix_count = read_u8(body, 36)
	if header.version ~= 1 or header.status > 2 or header.slot > 59 or
		affix_count > 4 or header.refinement_level > 15 or
		header.base_stats.physical_damage < 0 or header.base_stats.magic_attack < 0 or
		header.base_stats.physical_defense < 0 or header.base_stats.max_hp < 0 or
		header.base_stats.max_mp < 0 then
		return nil, "Detalhes de itemização fora do perfil Caracatoa."
	end
	if header.status == 2 then
		if header.rarity_id ~= 0 or header.client_item_id ~= 0 or header.item_level ~= 0 or affix_count ~= 0 then
			return nil, "Remoção de itemização contém dados de item."
		end
		header.affixes = {}
		return header
	end
	if header.rarity_id < 1 or header.rarity_id > 5 or header.client_item_id == 0 or
		header.item_level < 1 or header.item_level > 400 then
		return nil, "Raridade ou nível do item inválido."
	end
	header.affixes = {}
	local seen_affixes = {}
	for index = 0, 3 do
		local offset = 38 + index * 5
		local client_affix_id = read_u8(body, offset)
		local value = read_i32(body, offset + 1)
		if index < affix_count then
			if client_affix_id == 0 or seen_affixes[client_affix_id] or value < 0 or value > 100000 then
				return nil, "Afixo de item inválido ou repetido."
			end
			seen_affixes[client_affix_id] = true
			header.affixes[#header.affixes + 1] = { client_affix_id = client_affix_id, value = value }
		elseif client_affix_id ~= 0 or value ~= 0 then
			return nil, "Espaço de afixo não utilizado precisa estar zerado."
		end
	end
	return header
end

function Session.build_refinement_action_body(options)
	options = options or {}
	validate_range(options.inventory_slot, 0, 59, "Slot do equipamento")
	if options.use_divine_dust ~= true and options.use_divine_dust ~= false then
		error("Opção de Poeira Divina inválida.")
	end
	local request_id = options.request_id
	if type(request_id) ~= "string" or #request_id ~= 36 or
		not request_id:match("^[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+$") then
		error("Refinamento exige UUID de requisição.")
	end
	local body = new_body(0x7f10, options.client_id, options.timestamp or (os.time() % U32_MODULUS), 48)
	write_u8(body, 8, 1)
	write_u8(body, 9, options.inventory_slot)
	write_u8(body, 10, options.use_divine_dust and 1 or 0)
	write_bytes(body, 12, request_id:lower(), 36, "ID do refinamento")
	return to_binary(body)
end

function Session.build_stage_ritual_body(options)
	options = options or {}
	local request_id = options.request_id
	if type(request_id) ~= "string" or #request_id ~= 36 or
		not request_id:match("^[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+$") then
		error("Ritual exige UUID de requisição.")
	end
	local body = new_body(0x7f12, options.client_id, options.timestamp or (os.time() % U32_MODULUS), 48)
	write_u8(body, 8, 1)
	write_u8(body, 9, 1)
	write_bytes(body, 12, request_id:lower(), 36, "ID do ritual")
	return to_binary(body)
end

function Session.parse_refinement_result(body)
	local header, message = read_header(body, 24, 0x7f11)
	if not header then return nil, message end
	header.version = read_u8(body, 8)
	header.status = read_u8(body, 9)
	header.slot = read_u8(body, 10)
	header.old_level = read_u8(body, 11)
	header.target_level = read_u8(body, 12)
	header.new_level = read_u8(body, 13)
	header.success = read_u8(body, 14) == 1
	header.reason = read_u8(body, 15)
	header.material_client_item_id = read_u16(body, 16)
	header.chance_bps = read_u16(body, 18)
	header.divine_dust_used = read_u8(body, 20) == 1
	if header.version ~= 1 or header.status > 3 or header.slot > 59 or
		header.old_level > 15 or header.target_level > 15 or header.new_level > 15 or
		read_u8(body, 14) > 1 or header.reason > 10 or header.chance_bps > 10000 or
		read_u8(body, 20) > 1 or read_u8(body, 21) ~= 0 or read_u16(body, 22) ~= 0 then
		return nil, "Resultado do refinamento fora do perfil Caracatoa."
	end
	return header
end

local STAGE_NAMES = { "Mortal", "Arch", "Celestial", "Sub-Celestial" }
function Session.parse_stage_state(body)
	local header, message = read_header(body, 36, 0x7f13)
	if not header then return nil, message end
	header.version = read_u8(body, 8)
	header.status = read_u8(body, 9)
	local stage_id = read_u8(body, 10)
	header.stage_id = stage_id
	header.reason = read_u8(body, 11)
	header.stage_level = read_u16(body, 12)
	header.total_level = read_u16(body, 14)
	header.experience = read_u32(body, 16) + read_u32(body, 20) * U32_MODULUS
	header.available_attribute_points = read_u32(body, 24)
	header.available_skill_points = read_u32(body, 28)
	header.required_material_client_item_id = read_u16(body, 32)
	header.stage = STAGE_NAMES[stage_id + 1]
	if header.version ~= 1 or header.status > 2 or not header.stage or header.reason > 6 or
		header.stage_level < 1 or header.stage_level > 400 or header.total_level < 1 or header.total_level > 1600 or
		header.experience > 9007199254740991 or read_u16(body, 34) ~= 0 then
		return nil, "Estado de estágio fora do perfil Caracatoa."
	end
	return header
end

local MOUNT_ACTIONS = { list = 0, incubate = 1, feed = 2, evolve = 3, select = 4, ride = 5, dismount = 6 }
local MOUNT_ACTION_NAMES = { [0] = "list", [1] = "incubate", [2] = "feed", [3] = "evolve", [4] = "select", [5] = "ride", [6] = "dismount" }
local MOUNT_SPECIES = { [1] = "equus", [2] = "tigre", [3] = "lobo", [4] = "grifo", [5] = "hipogrifo", [6] = "pegaso", [7] = "dragao", [8] = "fentris" }
local MOUNT_STAGES = { [0] = "egg", [1] = "juvenile", [2] = "adult", [3] = "dead" }

function Session.build_mount_action_body(options)
	options = options or {}
	local action = type(options.action) == "string" and MOUNT_ACTIONS[options.action] or options.action
	validate_range(action, 0, 6, "Ação de montaria")
	local item_action = action == 1 or action == 2 or action == 3
	local inventory_slot = options.inventory_slot
	if item_action then
		validate_range(inventory_slot, 0, 59, "Slot de material")
	else
		inventory_slot = 0xff
	end
	local mount_id = options.mount_id or "00000000-0000-0000-0000-000000000000"
	if action == 0 then
		if options.mount_id ~= nil then error("Consulta de montarias não recebe ID.") end
	elseif type(mount_id) ~= "string" or not mount_id:match("^[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+$") or #mount_id ~= 36 then
		error("Ação de montaria exige ID UUID válido.")
	end
	local body = new_body(0x7f0c, options.client_id, options.timestamp or (os.time() % U32_MODULUS), 48)
	write_u8(body, 8, 1)
	write_u8(body, 9, action)
	write_u8(body, 10, inventory_slot)
	write_bytes(body, 12, mount_id:lower(), 36, "ID da montaria")
	return to_binary(body)
end

function Session.parse_mount_state(body)
	if type(body) ~= "string" or #body < 16 or read_u16(body, 0) ~= 0x7f0d then
		return nil, "Cabeçalho de montarias inválido."
	end
	local header = {
		client_id = read_u16(body, 2),
		timestamp = read_u32(body, 4),
		version = read_u8(body, 8),
		status = read_u8(body, 9),
		action_id = read_u8(body, 10),
		count = read_u8(body, 11),
		reason = read_u16(body, 12),
	}
	if header.client_id == 0 or header.version ~= 1 or header.status > 4 or
		header.action_id > 6 or header.reason > 7 or header.count > 20 or read_u16(body, 14) ~= 0 or
		#body ~= 16 + header.count * 84 then
		return nil, "Estado de montarias fora do perfil Caracatoa."
	end
	header.action = MOUNT_ACTION_NAMES[header.action_id]
	header.mounts = {}
	local identities = {}
	local active_count = 0
	for index = 0, header.count - 1 do
		local offset = 16 + index * 84
		local id = body:sub(offset + 1, offset + 36)
		local species_id = read_u8(body, offset + 36)
		local stage_id = read_u8(body, offset + 37)
		local flags = read_u8(body, offset + 39)
		local mount = {
			id = id,
			species_id = MOUNT_SPECIES[species_id],
			stage = MOUNT_STAGES[stage_id],
			level = read_u8(body, offset + 38),
			active = flags % 2 == 1,
			riding = math.floor(flags / 2) % 2 == 1,
			experience = read_u32(body, offset + 40),
			hunger = read_u16(body, offset + 44),
			max_hunger = read_u16(body, offset + 46),
			vitality = read_u16(body, offset + 48),
			max_vitality = read_u16(body, offset + 50),
			incubation_remaining = read_u16(body, offset + 52),
			required_level = read_u16(body, offset + 54),
			incubation_wait_ms = read_u32(body, offset + 56),
			bonuses = {
				hp = read_i32(body, offset + 60),
				physical_attack = read_i32(body, offset + 64),
				magic_attack = read_i32(body, offset + 68),
				defense = read_i32(body, offset + 72),
				move_speed_bps = read_u16(body, offset + 76),
				absorption_bps = read_u16(body, offset + 78),
			},
			remaining_lifetime_ms = read_u32(body, offset + 80),
		}
		if #id ~= 36 or not id:match("^[0-9a-f]+%-[0-9a-f]+%-[0-9a-f]+%-[0-9a-f]+%-[0-9a-f]+$") or
			not mount.species_id or not mount.stage or flags > 3 or mount.level < 1 or mount.level > 50 or
			mount.experience > 0x7fffffff or mount.max_hunger < 1 or mount.hunger > mount.max_hunger or
			mount.max_vitality < 1 or mount.vitality > mount.max_vitality or
			(mount.riding and not mount.active) or (mount.stage == "dead" and flags ~= 0) or
			mount.required_level < 1 or mount.required_level > 400 or identities[id] then
			return nil, "Entrada de montaria inválida."
		end
		identities[id] = true
		if mount.active then active_count = active_count + 1 end
		header.mounts[#header.mounts + 1] = mount
	end
	if active_count > 1 then return nil, "Mais de uma montaria ativa no estado recebido." end
	return header
end

local TRADE_ACTIONS = { invite = true, accept = true, decline = true, offer = true, ready = true, cancel = true }
local TRADE_STATUSES = { idle = true, invited = true, offering = true, committed = true, rejected = true, cancelled = true }
local function valid_trade_id(value)
	if type(value) ~= "string" then return false end
	local first, second, third, fourth, fifth = value:match("^(%x+)%-(%x+)%-(%x+)%-(%x+)%-(%x+)$")
	if not first or #first ~= 8 or #second ~= 4 or #third ~= 4 or #fourth ~= 4 or #fifth ~= 12 then
		return false
	end
	local version = tonumber(third:sub(1, 1), 16)
	local variant = tonumber(fourth:sub(1, 1), 16)
	return version ~= nil and version >= 1 and version <= 8 and
		variant ~= nil and variant >= 8 and variant <= 11
end

function Session.build_trade_action_body(options)
	options = options or {}
	local action = options.action
	if not TRADE_ACTIONS[action] then error("Ação de troca inválida.") end
	local payload = { action = action }
	if action == "invite" then
		local target = options.target_name
		if type(target) ~= "string" or #target < 1 or #target > 16 or not target:match("^[A-Za-z0-9_]+$") then
			error("Nome do destinatário inválido.")
		end
		payload.targetName = target
	elseif action == "offer" then
		local trade_id = options.trade_id
		if not valid_trade_id(trade_id) then
			error("ID da troca inválido.")
		end
		local inventory_slot = options.inventory_slot
		if inventory_slot ~= nil then validate_range(inventory_slot, 0, 59, "Slot de oferta") end
		local gold = options.gold or 0
		validate_range(gold, 0, 2147483647, "Gold ofertado")
		payload.tradeId = trade_id:lower()
		payload.inventorySlot = inventory_slot == nil and json.null or inventory_slot
		payload.gold = gold
	elseif action == "ready" then
		local trade_id = options.trade_id
		if not valid_trade_id(trade_id) then
			error("ID da troca inválido.")
		end
		validate_range(options.revision, 1, 0x7fffffff, "Revisão da oferta")
		payload.tradeId = trade_id:lower()
		payload.revision = options.revision
	else
		local trade_id = options.trade_id
		if not valid_trade_id(trade_id) then
			error("ID da troca inválido.")
		end
		payload.tradeId = trade_id:lower()
	end
	local encoded
	if action == "offer" and options.inventory_slot == nil then
		encoded = string.format(
			'{"action":"offer","tradeId":"%s","inventorySlot":null,"gold":%.0f}',
			payload.tradeId,
			payload.gold
		)
	else
		encoded = json.encode(payload)
	end
	if #encoded < 2 or #encoded > 1024 then error("Payload de troca inválido.") end
	local bytes = new_body(0x7f20, options.client_id, options.timestamp or (os.time() % U32_MODULUS), 12 + #encoded)
	write_u8(bytes, 8, 1)
	write_u8(bytes, 9, 0)
	write_u16(bytes, 10, #encoded)
	write_bytes(bytes, 12, encoded, #encoded, "Payload da troca")
	return to_binary(bytes)
end

local function valid_trade_offer(offer)
	if type(offer) ~= "table" then return false end
	local inventory_slot = offer.inventorySlot
	local item_client_id = offer.itemClientId
	return (inventory_slot == nil or inventory_slot == json.null or (is_integer(inventory_slot) and inventory_slot >= 0 and inventory_slot <= 59)) and
		(item_client_id == nil or item_client_id == json.null or (is_integer(item_client_id) and item_client_id >= 1 and item_client_id <= 0xffff)) and
		is_integer(offer.gold) and offer.gold >= 0 and offer.gold <= 2147483647 and
		type(offer.ready) == "boolean"
end

function Session.parse_trade_state(body)
	if type(body) ~= "string" or #body < 14 or read_u16(body, 0) ~= 0x7f21 then
		return nil, "Cabeçalho de troca inválido."
	end
	local client_id = read_u16(body, 2)
	local payload_length = read_u16(body, 10)
	if client_id == 0 or read_u8(body, 8) ~= 1 or read_u8(body, 9) ~= 0 or
		payload_length < 2 or payload_length > 1024 or #body ~= 12 + payload_length then
		return nil, "Frame de troca fora do perfil Caracatoa."
	end
	local ok, payload = pcall(json.decode, body:sub(13))
	if not ok or type(payload) ~= "table" or not TRADE_STATUSES[payload.status] or
		type(payload.message) ~= "string" or #payload.message > 120 or
		(payload.goldBalance ~= nil and payload.goldBalance ~= json.null and
			(not is_integer(payload.goldBalance) or payload.goldBalance < 0 or payload.goldBalance > 9007199254740991)) then
		return nil, "Payload de troca inválido."
	end
	local trade = nil
	if payload.trade ~= nil and payload.trade ~= json.null then
		local entry = payload.trade
		if type(entry) ~= "table" or not valid_trade_id(entry.tradeId) or not TRADE_STATUSES[entry.state] or
			not is_integer(entry.revision) or entry.revision < 0 or entry.revision > 0x7fffffff or
			type(entry.incoming) ~= "boolean" or not is_integer(entry.remainingMs) or entry.remainingMs < 0 or entry.remainingMs > 60000 or
			type(entry.selfName) ~= "string" or #entry.selfName < 1 or #entry.selfName > 16 or not entry.selfName:match("^[A-Za-z0-9_]+$") or
			type(entry.partnerName) ~= "string" or #entry.partnerName < 1 or #entry.partnerName > 16 or not entry.partnerName:match("^[A-Za-z0-9_]+$") or
			not valid_trade_offer(entry.selfOffer) or not valid_trade_offer(entry.partnerOffer) then
			return nil, "Estado de troca inválido."
		end
		trade = entry
	end
	local gold_balance = nil
	if payload.goldBalance ~= nil and payload.goldBalance ~= json.null then gold_balance = payload.goldBalance end
	return {
		client_id = client_id,
		timestamp = read_u32(body, 4),
		status = payload.status,
		message = payload.message,
		gold_balance = gold_balance,
		trade = trade,
	}
end

local SHOP_ACTIONS = { list = true, mine = true, create = true, buy = true, cancel = true }
local SHOP_STATUSES = { ok = true, rejected = true }
local function checked_shop_uuid(value, label)
	if not valid_trade_id(value) then error(label .. " inválido.") end
	return value:lower()
end

function Session.build_player_shop_action_body(options)
	options = options or {}
	local action = options.action
	if not SHOP_ACTIONS[action] then error("Ação do mercado inválida.") end
	local payload = { action = action }
	if action == "create" then
		validate_range(options.inventory_slot, 0, 59, "Slot do anúncio")
		validate_range(options.asking_gold, 1, 2147483647, "Preço do anúncio")
		payload.inventorySlot = options.inventory_slot
		payload.askingGold = options.asking_gold
	elseif action == "buy" then
		payload.listingId = checked_shop_uuid(options.listing_id, "Anúncio")
		payload.requestId = checked_shop_uuid(options.request_id, "Compra")
	elseif action == "cancel" then
		payload.listingId = checked_shop_uuid(options.listing_id, "Anúncio")
	end
	local encoded = json.encode(payload)
	if #encoded < 2 or #encoded > 4096 then error("Payload do mercado inválido.") end
	local bytes = new_body(0x7f22, options.client_id, options.timestamp or (os.time() % U32_MODULUS), 12 + #encoded)
	write_u8(bytes, 8, 1)
	write_u8(bytes, 9, 0)
	write_u16(bytes, 10, #encoded)
	write_bytes(bytes, 12, encoded, #encoded, "Payload do mercado")
	return to_binary(bytes)
end

local function valid_player_shop_listing(listing)
	if type(listing) ~= "table" or not valid_trade_id(listing.listingId) or
		type(listing.sellerName) ~= "string" or #listing.sellerName < 1 or #listing.sellerName > 16 or not listing.sellerName:match("^[A-Za-z0-9_]+$") or
		type(listing.catalogItemId) ~= "string" or #listing.catalogItemId < 1 or #listing.catalogItemId > 64 or not listing.catalogItemId:match("^[a-z0-9][a-z0-9._%-]*$") or
		not is_integer(listing.clientItemId) or listing.clientItemId < 1 or listing.clientItemId > 0xffff or
		(listing.itemInstanceId ~= nil and listing.itemInstanceId ~= json.null and not valid_trade_id(listing.itemInstanceId)) or
		not is_integer(listing.stackCount) or listing.stackCount < 1 or listing.stackCount > 500 or
		not is_integer(listing.askingGold) or listing.askingGold < 1 or listing.askingGold > 2147483647 or
		(listing.rarity ~= nil and listing.rarity ~= json.null and not ({ normal = true, mystic = true, arcane = true, legendary = true, ancient = true })[listing.rarity]) or
		(listing.itemLevel ~= nil and listing.itemLevel ~= json.null and (not is_integer(listing.itemLevel) or listing.itemLevel < 1 or listing.itemLevel > 400)) or
		(listing.refinementLevel ~= nil and listing.refinementLevel ~= json.null and (not is_integer(listing.refinementLevel) or listing.refinementLevel < 0 or listing.refinementLevel > 15)) or
		not is_integer(listing.createdAtMs) or listing.createdAtMs < 0 or
		not is_integer(listing.expiresAtMs) or listing.expiresAtMs <= listing.createdAtMs or
		type(listing.own) ~= "boolean" then
		return false
	end
	return true
end

function Session.parse_player_shop_state(body)
	if type(body) ~= "string" or #body < 14 or read_u16(body, 0) ~= 0x7f23 then
		return nil, "Cabeçalho do mercado inválido."
	end
	local client_id = read_u16(body, 2)
	local payload_length = read_u16(body, 10)
	if client_id == 0 or read_u8(body, 8) ~= 1 or read_u8(body, 9) ~= 0 or
		payload_length < 2 or payload_length > 4096 or #body ~= 12 + payload_length then
		return nil, "Frame do mercado fora do perfil Caracatoa."
	end
	local ok, payload = pcall(json.decode, body:sub(13))
	if not ok or type(payload) ~= "table" or not SHOP_STATUSES[payload.status] or
		type(payload.message) ~= "string" or #payload.message > 140 or
		(payload.reason ~= nil and payload.reason ~= json.null and (type(payload.reason) ~= "string" or #payload.reason > 48)) or
		(payload.view ~= "market" and payload.view ~= "mine") or
		(payload.goldBalance ~= nil and payload.goldBalance ~= json.null and
			(not is_integer(payload.goldBalance) or payload.goldBalance < 0 or payload.goldBalance > 2147483647)) or
		type(payload.listings) ~= "table" or #payload.listings > 8 then
		return nil, "Payload do mercado inválido."
	end
	for _, listing in ipairs(payload.listings) do
		if not valid_player_shop_listing(listing) then return nil, "Anúncio inválido no mercado." end
	end
	local receipt = payload.receipt
	if receipt == json.null then receipt = nil end
	if receipt ~= nil and (type(receipt) ~= "table" or not valid_trade_id(receipt.listingId) or
		type(receipt.catalogItemId) ~= "string" or #receipt.catalogItemId > 64 or
		not is_integer(receipt.clientItemId) or receipt.clientItemId < 1 or receipt.clientItemId > 0xffff or
		(receipt.itemInstanceId ~= nil and receipt.itemInstanceId ~= json.null and not valid_trade_id(receipt.itemInstanceId)) or
		not is_integer(receipt.stackCount) or receipt.stackCount < 1 or receipt.stackCount > 500 or
		not is_integer(receipt.inventorySlot) or receipt.inventorySlot < 0 or receipt.inventorySlot > 59 or
		not is_integer(receipt.askingGold) or receipt.askingGold < 1 or receipt.askingGold > 2147483647 or
		type(receipt.sellerName) ~= "string" or #receipt.sellerName > 16 or
		not is_integer(receipt.buyerGoldBalance) or receipt.buyerGoldBalance < 0 or receipt.buyerGoldBalance > 2147483647) then
		return nil, "Recibo de compra inválido."
	end
	return {
		client_id = client_id,
		timestamp = read_u32(body, 4),
		status = payload.status,
		message = payload.message,
		reason = payload.reason ~= json.null and payload.reason or nil,
		view = payload.view,
		gold_balance = payload.goldBalance ~= json.null and payload.goldBalance or nil,
		listings = payload.listings,
		receipt = receipt,
	}
end

function Session.parse_move_response(body)
	local header, message = read_header(body, 48, 0x366)
	if not header then return nil, message end
	header.last_position = { x = read_i16(body, 8), y = read_i16(body, 10) }
	header.move_type = read_u32(body, 12)
	header.speed_move = read_u32(body, 16)
	header.destination = { x = read_i16(body, 44), y = read_i16(body, 46) }
	if header.move_type > 15 or header.speed_move > 7 then
		return nil, "Resposta de movimento fora do perfil WYD 7.27."
	end
	return header
end

function Session.parse_monster_spawn(body)
	local header, message = read_header(body, 252, 0x364)
	if not header then return nil, message end
	header.entity_id = read_u16(body, 12)
	header.name = read_fixed_ascii(body, 14, 16)
	header.position = { x = read_i16(body, 8), y = read_i16(body, 10) }
	header.max_hp = read_i32(body, 152)
	header.current_hp = read_i32(body, 160)
	if header.entity_id == 0 or header.max_hp < 1 or header.current_hp < 0 or header.current_hp > header.max_hp then
		return nil, "Estado sintético da criatura fora do intervalo."
	end
	return header
end

function Session.parse_hp_mp_sync(body)
	local header, message = read_header(body, 16, 0x181)
	if not header then return nil, message end
	header.current_hp = read_i32(body, 8)
	header.current_mp = read_i32(body, 12)
	if header.current_hp < 0 or header.current_mp < 0 then
		return nil, "Recursos do personagem fora do intervalo."
	end
	return header
end

function Session.parse_skill_attack_result(body)
	local header, message = read_header(body, 68, 0x39d)
	if not header then return nil, message end
	if read_u8(body, 42) == 0xff then
		return nil, "Pacote recebido ainda tem a marca de pedido de habilidade."
	end
	header.skill_id = read_u16(body, 52)
	header.target_mob_index = read_u16(body, 56)
	header.damage = read_i32(body, 60)
	if header.skill_id < 1 or header.skill_id > 95 or header.target_mob_index == 0 or header.damage < 1 then
		return nil, "Resultado de habilidade fora do intervalo."
	end
	return header
end

function Session.parse_basic_attack_result(body)
	local header, message = read_header(body, 68, 0x39d)
	if not header then return nil, message end
	if read_u8(body, 42) == 0xff then
		return nil, "Pacote recebido ainda tem a marca de pedido de habilidade."
	end
	header.target_mob_index = read_u16(body, 56)
	header.damage = read_i32(body, 60)
	if header.target_mob_index == 0 or header.damage < 1 then
		return nil, "Resultado de ataque básico fora do intervalo."
	end
	return header
end

function Session.parse_caracatoa_skill_effect_result(body)
	local header, message = read_header(body, 32, 0x7f09)
	if not header then return nil, message end
	header.version = read_u8(body, 8)
	header.status = read_u8(body, 9)
	header.skill_id = read_u8(body, 10)
	header.effect_type = read_u8(body, 11)
	header.amount = read_i32(body, 12)
	header.healed = header.effect_type == 1 and header.amount or 0
	header.defense_bonus = header.effect_type == 2 and header.amount or 0
	header.current_hp = read_i32(body, 16)
	header.max_hp = read_i32(body, 20)
	header.current_mp = read_i32(body, 24)
	header.duration_ms = read_u32(body, 28)
	if header.version ~= 1 or header.status > 3 or header.skill_id < 1 or header.skill_id > 95 or
		(header.effect_type ~= 1 and header.effect_type ~= 2) or header.amount < 0 or header.current_hp < 0 or
		header.max_hp < 1 or header.current_hp > header.max_hp or header.current_mp < 0 or
		(header.status == 0 and header.amount == 0) or
		(header.status ~= 0 and header.amount ~= 0) or
		(header.effect_type == 1 and header.duration_ms ~= 0) or
		(header.effect_type == 2 and header.status == 0 and header.duration_ms < 1000) or
		(header.effect_type == 2 and header.status ~= 0 and header.duration_ms ~= 0) then
		return nil, "Resultado de efeito de habilidade Caracatoa fora do intervalo."
	end
	return header
end

local function from_hex(value)
	if type(value) ~= "string" or #value % 2 ~= 0 or value:find("[^0-9a-fA-F]") then return nil end
	local chunks = {}
	for index = 1, #value, 2 do
		chunks[#chunks + 1] = string.char(tonumber(value:sub(index, index + 1), 16))
	end
	return table.concat(chunks)
end

local function same(left, right)
	return left == right
end

function Session.run_self_test(Protocol)
	local fixtures = require "main.wyd_session_fixtures"
	for _, value in ipairs({ "", " ", "A", "az09-_~" }) do
		if not pcall(validate_ascii, value, "fixture ASCII") then
			return false, "Validador sintético recusou ASCII imprimível."
		end
	end
	for _, value in ipairs({ "\0", "\t", "\n", string.char(0x7f), "á" }) do
		if pcall(validate_ascii, value, "fixture ASCII") then
			return false, "Validador sintético aceitou byte fora do ASCII imprimível."
		end
	end
	local test_account = string.rep("A", 12)
	local test_password = string.rep("P", 9)
	local test_pin = string.rep("7", 6)
	if not Session.is_valid_login_password(test_password) or not Session.is_valid_login_password("TestPass9") or
		Session.is_valid_login_password("bad\npass") or Session.is_valid_login_password("senha-á") then
		return false, "Validador sintético de senha de login divergente."
	end
	for _, account_id in ipairs({ "A", "Player.01", "A_b-9", string.rep("Z", 15) }) do
		if not Session.is_valid_account_id(account_id) then
			return false, "Validação sintética recusou um ID de conta permitido."
		end
	end
	for _, account_id in ipairs({ "", ".player", "_player", "-player", string.rep("A", 16), "bad id", "á" }) do
		if Session.is_valid_account_id(account_id) then
			return false, "Validação sintética aceitou um ID de conta inválido."
		end
	end
	local requests = {
		{ name = "account_login_0x20d", body = Session.build_account_login_body({ account_id = test_account, password = test_password, client_version = 0x12345678, adapter_id = string.rep("\0", 16), mac = string.rep("\0", 6), timestamp = 0x01020304 }) },
		{ name = "token_0xfde", body = Session.build_token_body({ pin = test_pin, timestamp = 0x01020304 }) },
		{ name = "request_character_entry_0x213", body = Session.build_character_entry_body({ slot = 2, shift = 3, timestamp = 0x01020304 }) },
		{ name = "create_character_0x7f00", body = Session.build_character_create_body({ slot = 0, class_id = 0, name = "SYNTH_AVATAR", client_id = 0x1234, timestamp = 0x01020304 }) },
	}
	local request_vectors = {}
	for _, vector in ipairs(fixtures.requests) do request_vectors[vector.name] = vector end
	for _, request in ipairs(requests) do
		local vector = request_vectors[request.name]
		local safe_body = vector and Session.redact_request_body(read_u16(request.body, 0), request.body) or nil
		local expected_body = vector and from_hex(vector.redacted_body_hex) or nil
		local expected_wire = vector and from_hex(vector.redacted_frame_hex) or nil
		local encoded = safe_body and Protocol.encode_frame(safe_body, vector.sequence) or nil
		if not vector or not expected_body or not expected_wire or not same(safe_body, expected_body) or not encoded or not encoded.ok or encoded.wire ~= expected_wire then
			return false, "Builder sintético divergente em " .. request.name
		end
	end

	local response = {}
	for _, vector in ipairs(fixtures.responses) do
		local body = from_hex(vector.body_hex)
		if not body or #body + 4 ~= vector.packet_size or read_u16(body, 0) ~= vector.opcode then
			return false, "Fixture sintética inválida: " .. vector.name
		end
		response[vector.name] = body
	end
	local login, login_error = Session.parse_login_success(response.login_success_0x10a)
	local accepted, accepted_error = Session.parse_token_result(response.token_accepted_0xfde)
	local rejected, rejected_error = Session.parse_token_result(response.token_rejected_0xfdf)
	local created, created_error = Session.parse_character_create_result(response.character_create_result_0x7f01)
	local roster, roster_error = Session.parse_character_roster(response.character_roster_0x110)
	local world, world_error = Session.parse_character_world(response.character_world_0x114)
	if not login or login.hash_key_table ~= string.char(0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50) then
		return false, login_error or "Parser sintético 0x10A divergente."
	end
	local sequence_state, sequence_error = Session.new_request_sequence_state(login.hash_key_table)
	local token_sequence = sequence_state and Session.next_request_sequence(sequence_state) or nil
	local entry_sequence = sequence_state and Session.next_request_sequence(sequence_state) or nil
	if token_sequence ~= 0xbe or entry_sequence ~= 0xbd then
		return false, sequence_error or "Ordem sintética de sequência WYD divergente."
	end
	if not accepted or not accepted.accepted or not rejected or rejected.accepted then
		return false, accepted_error or rejected_error or "Parser sintético de PIN divergente."
	end
	local keepalive = Session.build_keepalive_body({ mob_index = 0x2345, timestamp = 0x01020304 })
	if #keepalive ~= 8 or read_u16(keepalive, 0) ~= 0x3a0 or read_u16(keepalive, 2) ~= 0x2345 then
		return false, "Builder sintético 0x3A0 divergente."
	end
	local movement = Session.build_move_body({ mob_index = 0x2345, position = { x = -12, y = 34 }, direction_code = 0x39, timestamp = 0x01020304 })
	if #movement ~= 48 or read_u16(movement, 0) ~= 0x36c or read_u16(movement, 2) ~= 0x2345 or read_i16(movement, 8) ~= -12 or read_i16(movement, 10) ~= 34 or read_u32(movement, 12) ~= 0 or read_u32(movement, 16) ~= 7 or string.byte(movement, 21) ~= 0x39 or read_i16(movement, 44) ~= -11 or read_i16(movement, 46) ~= 35 then
		return false, "Builder sintético 0x36C divergente."
	end
	local movement_reply = new_body(0x366, 0x2345, 0x01020304, 48)
	write_i16(movement_reply, 8, -12)
	write_i16(movement_reply, 10, 34)
	write_u32(movement_reply, 12, 0)
	write_u32(movement_reply, 16, 3)
	write_i16(movement_reply, 44, -11)
	write_i16(movement_reply, 46, 35)
	local parsed_movement = Session.parse_move_response(to_binary(movement_reply))
	if not parsed_movement or parsed_movement.client_id ~= 0x2345 or parsed_movement.destination.x ~= -11 or parsed_movement.destination.y ~= 35 or parsed_movement.speed_move ~= 3 then
		return false, "Parser sintético 0x366 divergente."
	end
	local skill_request = Session.build_single_target_skill_attack_body({
		client_id = 0x2345,
		timestamp = 0x01020304,
		skill_id = 25,
		target_mob_index = 0x3456,
		source_position = { x = 322, y = 123 },
		target_position = { x = 323, y = 123 },
	})
	if #skill_request ~= 68 or read_u16(skill_request, 0) ~= 0x39d or read_u16(skill_request, 30) ~= 322 or read_u16(skill_request, 34) ~= 323 or read_u16(skill_request, 38) ~= 0x2345 or read_u8(skill_request, 42) ~= 0xff or read_i32(skill_request, 48) ~= -1 or read_u16(skill_request, 52) ~= 25 or read_u16(skill_request, 56) ~= 0x3456 or read_i32(skill_request, 60) ~= -1 then
		return false, "Builder sintético 0x39D de habilidade divergente."
	end
	local basic_request = Session.build_basic_attack_body({
		client_id = 0x2345,
		timestamp = 0x01020304,
		target_mob_index = 0x3456,
		source_position = { x = 322, y = 123 },
		target_position = { x = 323, y = 123 },
	})
	if #basic_request ~= 68 or read_u16(basic_request, 0) ~= 0x39d or read_u8(basic_request, 42) ~= 4 or
		read_i32(basic_request, 48) ~= 0 or read_i16(basic_request, 52) ~= -1 or
		read_u16(basic_request, 56) ~= 0x3456 or read_i32(basic_request, 60) ~= -2 then
		return false, "Builder sintético de ataque básico 0x39D divergente."
	end
	local basic_result_body = new_body(0x39d, 0x2345, 0x01020304, 68)
	write_u16(basic_result_body, 56, 0x3456)
	write_i32(basic_result_body, 60, 23)
	local parsed_basic_result = Session.parse_basic_attack_result(to_binary(basic_result_body))
	if not parsed_basic_result or parsed_basic_result.target_mob_index ~= 0x3456 or parsed_basic_result.damage ~= 23 then
		return false, "Parser sintético do resultado de ataque básico divergente."
	end
	local attribute_request = Session.build_attribute_allocation_body({
		client_id = 0x2345,
		timestamp = 0x01020304,
		attribute_id = 1,
	})
	if #attribute_request ~= 12 or read_u16(attribute_request, 0) ~= 0x7f03 or
		read_u16(attribute_request, 2) ~= 0x2345 or read_u32(attribute_request, 4) ~= 0x01020304 or
		read_u8(attribute_request, 8) ~= 1 or read_u8(attribute_request, 9) ~= 1 or
		read_u8(attribute_request, 10) ~= 1 or read_u8(attribute_request, 11) ~= 0 then
		return false, "Builder sintético 0x7F03 de atributo divergente."
	end
	local learn_request = Session.build_skill_learn_body({
		client_id = 0x2345,
		timestamp = 0x01020304,
		skill_id = 25,
	})
	if #learn_request ~= 12 or read_u16(learn_request, 0) ~= 0x7f05 or
		read_u16(learn_request, 2) ~= 0x2345 or read_u32(learn_request, 4) ~= 0x01020304 or
		read_u8(learn_request, 8) ~= 1 or read_u8(learn_request, 9) ~= 25 or
		read_u16(learn_request, 10) ~= 0 then
		return false, "Builder sintético 0x7F05 de aprendizado divergente."
	end
	local equipment_request = Session.build_equipment_change_body({
		client_id = 0x2345,
		equipment_slot = 0,
		inventory_slot = 7,
		timestamp = 0x01020304,
	})
	if #equipment_request ~= 12 or read_u16(equipment_request, 0) ~= 0x7f07 or
		read_u16(equipment_request, 2) ~= 0x2345 or read_u8(equipment_request, 4) ~= 0 or
		read_u8(equipment_request, 5) ~= 7 or read_u32(equipment_request, 6) ~= 0x01020304 then
		return false, "Builder sintético 0x7F07 de equipamento divergente."
	end
	local skill_state_reply = new_body(0x7f06, 0x2345, 0x01020304, 32)
	write_u8(skill_state_reply, 8, 1)
	write_u8(skill_state_reply, 9, 1)
	write_u8(skill_state_reply, 10, 25)
	write_u32(skill_state_reply, 12, 0)
	write_u8(skill_state_reply, 19, 1)
	local parsed_skill_state = Session.parse_skill_state(to_binary(skill_state_reply))
	if not parsed_skill_state or parsed_skill_state.skill_id ~= 25 or
		parsed_skill_state.available_points ~= 0 or
		parsed_skill_state.learned_skills[25] ~= true then
		return false, "Parser sintético 0x7F06 de habilidade divergente."
	end
	local equipment_reply = new_body(0x7f08, 0x2345, 0, 18)
	write_u8(equipment_reply, 4, 0)
	write_u8(equipment_reply, 5, 0)
	write_u8(equipment_reply, 6, 7)
	write_u16(equipment_reply, 8, 7001)
	write_u16(equipment_reply, 10, 5)
	write_u16(equipment_reply, 14, 5)
	local parsed_equipment = Session.parse_equipment_state(to_binary(equipment_reply))
	if not parsed_equipment or parsed_equipment.client_item_id ~= 7001 or
		parsed_equipment.inventory_slot ~= 7 or parsed_equipment.total_attack_bonus ~= 5 then
		return false, "Parser sintético 0x7F08 de equipamento divergente."
	end
	local heal_reply = new_body(0x7f09, 0x2345, 0x01020304, 32)
	write_u8(heal_reply, 8, 1)
	write_u8(heal_reply, 9, 0)
	write_u8(heal_reply, 10, 27)
	write_u8(heal_reply, 11, 1)
	write_i32(heal_reply, 12, 31)
	write_i32(heal_reply, 16, 80)
	write_i32(heal_reply, 20, 100)
	write_i32(heal_reply, 24, 90)
	local parsed_heal, heal_error = Session.parse_caracatoa_skill_effect_result(to_binary(heal_reply))
	if not parsed_heal or parsed_heal.skill_id ~= 27 or parsed_heal.healed ~= 31 or
		parsed_heal.current_hp ~= 80 or parsed_heal.max_hp ~= 100 or parsed_heal.current_mp ~= 90 then
		return false, heal_error or "Parser sintético 0x7F09 de cura divergente."
	end
	local defense_reply = new_body(0x7f09, 0x2345, 0x01020305, 32)
	write_u8(defense_reply, 8, 1)
	write_u8(defense_reply, 9, 0)
	write_u8(defense_reply, 10, 3)
	write_u8(defense_reply, 11, 2)
	write_i32(defense_reply, 12, 21)
	write_i32(defense_reply, 16, 80)
	write_i32(defense_reply, 20, 100)
	write_i32(defense_reply, 24, 88)
	write_u32(defense_reply, 28, 8000)
	local parsed_defense, defense_error = Session.parse_caracatoa_skill_effect_result(to_binary(defense_reply))
	if not parsed_defense or parsed_defense.skill_id ~= 3 or parsed_defense.defense_bonus ~= 21 or
		parsed_defense.duration_ms ~= 8000 or parsed_defense.current_hp ~= 80 or parsed_defense.current_mp ~= 88 then
		return false, defense_error or "Parser sintético 0x7F09 de defesa divergente."
	end
	local world_fixture = new_body(0x114, 0x2345, 0x01020304, 2100)
	write_i16(world_fixture, 8, 321)
	write_i16(world_fixture, 10, 123)
	write_fixed_ascii(world_fixture, 12, "SYNTH_AVATAR", 18, "nome de fixture")
	write_u8(world_fixture, 32, 1)
	write_u32(world_fixture, 44, 9)
	write_i32(world_fixture, 56, 0)
	write_u16(world_fixture, 1382, 0x2345)
	write_u16(world_fixture, 368, 7001)
	write_i16(world_fixture, 370, 1)
	write_u16(world_fixture, 380, 7002)
	write_i16(world_fixture, 382, 1)
	local parsed_world = Session.parse_character_world(to_binary(world_fixture))
	if not parsed_world or parsed_world.experience ~= 9 or not parsed_world.inventory_items[0] or
		parsed_world.inventory_items[0].client_item_id ~= 7001 or
		parsed_world.inventory_items[1].client_item_id ~= 7002 then
		return false, "Parser sintético 0x114 de XP/inventário divergente."
	end
	local inventory_delta = new_body(0x182, 0x2345, 0x01020304, 24)
	write_u16(inventory_delta, 8, 1)
	write_i16(inventory_delta, 10, 1)
	write_u16(inventory_delta, 12, 7002)
	write_i16(inventory_delta, 14, 1)
	local parsed_inventory_delta = Session.parse_inventory_slot_delta(to_binary(inventory_delta))
	if not parsed_inventory_delta or parsed_inventory_delta.slot ~= 1 or
		parsed_inventory_delta.client_item_id ~= 7002 or parsed_inventory_delta.stack_count ~= 1 then
		return false, "Parser sintético 0x182 do inventário divergente."
	end
	local itemization_reply = new_body(0x7f0a, 0x2345, 0x01020304, 58)
	write_u8(itemization_reply, 8, 1)
	write_u8(itemization_reply, 9, 1)
	write_u8(itemization_reply, 10, 0)
	write_u8(itemization_reply, 11, 2)
	write_u16(itemization_reply, 12, 8001)
	write_u16(itemization_reply, 14, 40)
	write_i32(itemization_reply, 16, 52)
	write_i32(itemization_reply, 24, 3)
	write_i32(itemization_reply, 28, 12)
	write_u8(itemization_reply, 36, 1)
	write_u8(itemization_reply, 38, 4)
	write_i32(itemization_reply, 39, 6)
	local parsed_itemization = Session.parse_itemization_detail(to_binary(itemization_reply))
	if not parsed_itemization or parsed_itemization.rarity_id ~= 2 or parsed_itemization.item_level ~= 40 or
		parsed_itemization.base_stats.physical_damage ~= 52 or parsed_itemization.affixes[1].client_affix_id ~= 4 or
		parsed_itemization.affixes[1].value ~= 6 then
		return false, "Parser sintético 0x7F0A de afixos divergente."
	end
	local progression_reply = new_body(0x7f02, 0x2345, 0x01020304, 44)
	write_u8(progression_reply, 8, 1)
	write_u32(progression_reply, 12, 2)
	write_u32(progression_reply, 16, 10)
	write_i32(progression_reply, 24, 100)
	write_i32(progression_reply, 28, 110)
	write_i32(progression_reply, 32, 93)
	write_i32(progression_reply, 36, 105)
	write_i32(progression_reply, 40, 12)
	local parsed_progression = Session.parse_progression_sync(to_binary(progression_reply))
	if not parsed_progression or parsed_progression.level ~= 2 or parsed_progression.experience ~= 10 or
		parsed_progression.max_hp ~= 110 or parsed_progression.max_mp ~= 105 then
		return false, "Parser sintético 0x7F02 de progressão divergente."
	end
	local attribute_reply = new_body(0x7f04, 0x2345, 0x01020304, 48)
	write_u8(attribute_reply, 8, 1)
	write_u8(attribute_reply, 9, 3)
	write_u8(attribute_reply, 10, 0xff)
	write_u32(attribute_reply, 12, 5)
	write_u16(attribute_reply, 16, 10)
	write_u16(attribute_reply, 18, 10)
	write_u16(attribute_reply, 20, 10)
	write_u16(attribute_reply, 22, 10)
	write_i32(attribute_reply, 24, 100)
	write_i32(attribute_reply, 28, 100)
	write_i32(attribute_reply, 32, 100)
	write_i32(attribute_reply, 36, 100)
	write_i32(attribute_reply, 40, 10)
	write_i32(attribute_reply, 44, 0)
	local parsed_attributes = Session.parse_attribute_sync(to_binary(attribute_reply))
	if not parsed_attributes or parsed_attributes.status ~= 3 or parsed_attributes.attribute_id ~= 0xff or
		parsed_attributes.available_points ~= 5 or parsed_attributes.int ~= 10 or parsed_attributes.max_mp ~= 100 then
		return false, "Parser sintético 0x7F04 de atributos divergente."
	end
	local monster_reply = {}
	for index = 1, 252 do monster_reply[index] = 0 end
	write_u16(monster_reply, 0, 0x364)
	write_u16(monster_reply, 12, 0x3456)
	write_fixed_ascii(monster_reply, 14, "Golem de Pedra", 16, "nome do monstro")
	write_i16(monster_reply, 8, 323)
	write_i16(monster_reply, 10, 123)
	write_i32(monster_reply, 152, 50)
	write_i32(monster_reply, 160, 50)
	local parsed_monster = Session.parse_monster_spawn(to_binary(monster_reply))
	if not parsed_monster or parsed_monster.entity_id ~= 0x3456 or parsed_monster.name ~= "Golem de Pedra" or parsed_monster.position.x ~= 323 or parsed_monster.current_hp ~= 50 then
		return false, "Parser sintético 0x364 de criatura divergente."
	end
	local hp_mp_reply = new_body(0x181, 0x2345, 0x01020304, 16)
	write_i32(hp_mp_reply, 8, 100)
	write_i32(hp_mp_reply, 12, 93)
	local parsed_resources = Session.parse_hp_mp_sync(to_binary(hp_mp_reply))
	if not parsed_resources or parsed_resources.current_hp ~= 100 or parsed_resources.current_mp ~= 93 then
		return false, "Parser sintético 0x181 de recursos divergente."
	end
	local skill_reply = new_body(0x39d, 0x2345, 0x01020304, 68)
	write_u16(skill_reply, 52, 25)
	write_u16(skill_reply, 56, 0x3456)
	write_i32(skill_reply, 60, 16)
	local parsed_skill = Session.parse_skill_attack_result(to_binary(skill_reply))
	if not parsed_skill or parsed_skill.skill_id ~= 25 or parsed_skill.target_mob_index ~= 0x3456 or parsed_skill.damage ~= 16 then
		return false, "Parser sintético 0x39D de resultado de habilidade divergente."
	end
	if not created or created.status ~= 0 or created.slot ~= 0 or created.class_id ~= 0 then
		return false, created_error or "Parser sintético 0x7F01 divergente."
	end
	if not roster or roster.selection[3].name ~= "SYNTH_SLOT" or roster.selection[3].class_id ~= 2 or roster.selection[3].level ~= 7 or roster.selection[3].gold ~= 99 then
		return false, roster_error or "Parser sintético 0x110 divergente."
	end
	if not world or world.name ~= "SYNTH_WORLD" or world.position.x ~= 300 or world.position.y ~= 400 or world.class_id ~= 1 or world.level ~= 3 or world.gold ~= 321 or world.mob_index ~= 0x1234 then
		return false, world_error or "Parser sintético 0x114 divergente."
	end
	local mount_id = "f7796323-341b-44f9-9294-302d15e3b063"
	local mount_request = Session.build_mount_action_body({
		client_id = 0x2345, timestamp = 0x11223344, action = "feed", mount_id = mount_id, inventory_slot = 7,
	})
	if #mount_request ~= 48 or read_u16(mount_request, 0) ~= 0x7f0c or read_u16(mount_request, 2) ~= 0x2345 or
		read_u32(mount_request, 4) ~= 0x11223344 or read_u8(mount_request, 8) ~= 1 or
		read_u8(mount_request, 9) ~= 2 or read_u8(mount_request, 10) ~= 7 or mount_request:sub(13, 48) ~= mount_id then
		return false, "Builder sintético 0x7F0C de montaria divergente."
	end
	local mount_reply = new_body(0x7f0d, 0x2345, 0x11223344, 100)
	write_u8(mount_reply, 8, 1)
	write_u8(mount_reply, 9, 0)
	write_u8(mount_reply, 10, 0)
	write_u8(mount_reply, 11, 1)
	write_bytes(mount_reply, 16, mount_id, 36, "ID sintético de montaria")
	write_u8(mount_reply, 52, 1)
	write_u8(mount_reply, 53, 1)
	write_u8(mount_reply, 54, 2)
	write_u8(mount_reply, 55, 1)
	write_u32(mount_reply, 56, 130)
	write_u16(mount_reply, 60, 120)
	write_u16(mount_reply, 62, 180)
	write_u16(mount_reply, 64, 100)
	write_u16(mount_reply, 66, 100)
	write_u16(mount_reply, 68, 0)
	write_u16(mount_reply, 70, 1)
	write_u32(mount_reply, 72, 0)
	write_i32(mount_reply, 76, 21)
	write_i32(mount_reply, 80, 0)
	write_i32(mount_reply, 84, 0)
	write_i32(mount_reply, 88, 2)
	write_u16(mount_reply, 92, 250)
	write_u16(mount_reply, 94, 0)
	write_u32(mount_reply, 96, 0)
	local parsed_mounts, mount_error = Session.parse_mount_state(to_binary(mount_reply))
	if not parsed_mounts or parsed_mounts.client_id ~= 0x2345 or parsed_mounts.mounts[1].id ~= mount_id or
		parsed_mounts.mounts[1].stage ~= "juvenile" or not parsed_mounts.mounts[1].active or
		parsed_mounts.mounts[1].hunger ~= 120 or parsed_mounts.mounts[1].bonuses.hp ~= 21 or
		parsed_mounts.mounts[1].bonuses.move_speed_bps ~= 250 then
		return false, mount_error or "Parser sintético 0x7F0D de montarias divergente."
	end
	local trade_request = Session.build_trade_action_body({
		client_id = 0x2345, timestamp = 0x11223344, action = "offer",
		trade_id = "00000000-0000-4000-8000-000000000001", inventory_slot = nil, gold = 125,
	})
	if read_u16(trade_request, 0) ~= 0x7f20 or read_u16(trade_request, 2) ~= 0x2345 or
		read_u8(trade_request, 8) ~= 1 or read_u8(trade_request, 9) ~= 0 or
		#trade_request ~= 12 + read_u16(trade_request, 10) then
		return false, "Builder sintético 0x7F20 de troca divergente."
	end
	local request_ok, request_payload = pcall(json.decode, trade_request:sub(13))
		if not request_ok or request_payload.action ~= "offer" or
			(request_payload.inventorySlot ~= nil and request_payload.inventorySlot ~= json.null) or request_payload.gold ~= 125 then
		return false, "Payload sintético de oferta Caracatoa divergente."
	end
	local malformed_id_ok = pcall(Session.build_trade_action_body, {
		client_id = 0x2345, action = "cancel", trade_id = "00000000-0000-4000-8000-00000000000Z",
	})
	if malformed_id_ok then return false, "Validação sintética aceitou um UUID de troca malformado." end
	local trade_payload = json.encode({
		status = "offering", message = "Duas confirmações exigidas.", goldBalance = json.null,
		trade = {
			tradeId = "00000000-0000-4000-8000-000000000001", state = "offering", revision = 3,
			incoming = false, remainingMs = 30000, selfName = "TraderA", partnerName = "TraderB",
			selfOffer = { inventorySlot = json.null, itemClientId = json.null, gold = 125, ready = true },
			partnerOffer = { inventorySlot = 2, itemClientId = 7002, gold = 0, ready = false },
		},
	})
	local trade_reply = new_body(0x7f21, 0x2345, 0x11223344, 12 + #trade_payload)
	write_u8(trade_reply, 8, 1)
	write_u16(trade_reply, 10, #trade_payload)
	write_bytes(trade_reply, 12, trade_payload, #trade_payload, "Payload sintético de troca")
	local parsed_trade, trade_error = Session.parse_trade_state(to_binary(trade_reply))
	if not parsed_trade or parsed_trade.client_id ~= 0x2345 or parsed_trade.status ~= "offering" or
		parsed_trade.trade.revision ~= 3 or parsed_trade.trade.partnerOffer.itemClientId ~= 7002 or
		(parsed_trade.trade.selfOffer.inventorySlot ~= nil and parsed_trade.trade.selfOffer.inventorySlot ~= json.null) then
		return false, trade_error or "Parser sintético 0x7F21 de troca divergente."
	end
	local idle_payload = json.encode({ status = "idle", message = "", goldBalance = json.null, trade = json.null })
	local idle_reply = new_body(0x7f21, 0x2345, 0x11223345, 12 + #idle_payload)
	write_u8(idle_reply, 8, 1)
	write_u16(idle_reply, 10, #idle_payload)
	write_bytes(idle_reply, 12, idle_payload, #idle_payload, "Payload sintético sem troca")
	local parsed_idle_trade, idle_trade_error = Session.parse_trade_state(to_binary(idle_reply))
	if not parsed_idle_trade or parsed_idle_trade.trade ~= nil or parsed_idle_trade.gold_balance ~= nil then
		return false, idle_trade_error or "Parser não reconheceu estado sem negociação."
	end
	local shop_request = Session.build_player_shop_action_body({
		client_id = 0x2345, timestamp = 0x11223346, action = "create",
		inventory_slot = 4, asking_gold = 1200,
	})
	if read_u16(shop_request, 0) ~= 0x7f22 or read_u16(shop_request, 2) ~= 0x2345 or
		read_u8(shop_request, 8) ~= 1 or read_u8(shop_request, 9) ~= 0 or
		#shop_request ~= 12 + read_u16(shop_request, 10) then
		return false, "Builder sintético 0x7F22 do mercado divergente."
	end
	local shop_request_ok, shop_request_payload = pcall(json.decode, shop_request:sub(13))
	if not shop_request_ok or shop_request_payload.action ~= "create" or
		shop_request_payload.inventorySlot ~= 4 or shop_request_payload.askingGold ~= 1200 then
		return false, "Payload sintético de anúncio Caracatoa divergente."
	end
	local malformed_shop_id_ok = pcall(Session.build_player_shop_action_body, {
		client_id = 0x2345, action = "buy", listing_id = "00000000-0000-4000-8000-00000000000Z",
		request_id = "00000000-0000-4000-8000-000000000002",
	})
	if malformed_shop_id_ok then return false, "Validação sintética aceitou UUID de anúncio inválido." end
	local shop_payload = json.encode({
		status = "ok", message = "Feira de jogadores atualizada.", reason = json.null,
		view = "market", goldBalance = 5000, receipt = json.null,
		listings = {{
			listingId = "00000000-0000-4000-8000-000000000001", sellerName = "LojaAlpha",
			catalogItemId = "caracatoa-bronze-couraca-elos-da-sentinela", clientItemId = 8221,
			itemInstanceId = "00000000-0000-4000-8000-000000000002", stackCount = 1,
			askingGold = 1200, rarity = "mystic", itemLevel = 1, refinementLevel = 0,
			createdAtMs = 1000, expiresAtMs = 604801000, own = false,
		}},
	})
	local shop_reply = new_body(0x7f23, 0x2345, 0x11223347, 12 + #shop_payload)
	write_u8(shop_reply, 8, 1)
	write_u16(shop_reply, 10, #shop_payload)
	write_bytes(shop_reply, 12, shop_payload, #shop_payload, "Payload sintético da feira")
	local parsed_shop, shop_error = Session.parse_player_shop_state(to_binary(shop_reply))
	if not parsed_shop or parsed_shop.client_id ~= 0x2345 or parsed_shop.status ~= "ok" or
		parsed_shop.gold_balance ~= 5000 or #parsed_shop.listings ~= 1 or
		parsed_shop.listings[1].clientItemId ~= 8221 or parsed_shop.listings[1].own ~= false then
		return false, shop_error or "Parser sintético 0x7F23 da feira divergente."
	end
	return true, "Builders/parsers Lua, IDs de conta, troca e feira passaram vetores sintéticos redigidos."
end

return Session

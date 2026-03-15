local GRID_COLS = 7
local GRID_ROWS = 7
local TOTAL_CELLS = GRID_COLS * GRID_ROWS
local MIN_CLUSTER_SIZE = 5
local MULTIPLIER_BASE = 2
local MULTIPLIER_MAX = 1024
local MAX_WIN_MULTIPLIER = 25000
local RTP_FACTOR = 0.527
local FS_SCATTER_BOOST_STANDARD = 21.5
local FS_SCATTER_BOOST_SUPER = 24
local SCATTER_ID = 8

local SYMBOL_KEYS = {
    [1] = "major_star",
    [2] = "major_heart",
    [3] = "major_crystal",
    [4] = "minor_red",
    [5] = "minor_green",
    [6] = "minor_purple",
    [7] = "minor_yellow",
    [8] = "scatter",
}

local REEL_SYMBOLS = {
    { id = 1, weight = 6 },
    { id = 2, weight = 7 },
    { id = 3, weight = 8 },
    { id = 4, weight = 14 },
    { id = 5, weight = 14 },
    { id = 6, weight = 14 },
    { id = 7, weight = 14 },
}

local FREE_SPINS_TABLE = {
    [3] = 10,
    [4] = 12,
    [5] = 15,
    [6] = 20,
    [7] = 30,
}

local CLUSTER_PAYOUTS = {
    [1] = { [5] = 5, [6] = 7, [7] = 10, [8] = 15, [9] = 20, [10] = 30, [11] = 40, [12] = 60, [13] = 80, [14] = 100, [15] = 150 },
    [2] = { [5] = 4, [6] = 5, [7] = 8, [8] = 12, [9] = 15, [10] = 25, [11] = 35, [12] = 50, [13] = 65, [14] = 85, [15] = 120 },
    [3] = { [5] = 3, [6] = 4, [7] = 6, [8] = 10, [9] = 12, [10] = 20, [11] = 28, [12] = 40, [13] = 55, [14] = 70, [15] = 100 },
    [4] = { [5] = 1.5, [6] = 2, [7] = 3, [8] = 4, [9] = 5, [10] = 8, [11] = 10, [12] = 14, [13] = 18, [14] = 22, [15] = 30 },
    [5] = { [5] = 1.2, [6] = 1.8, [7] = 2.5, [8] = 3.5, [9] = 4.5, [10] = 7, [11] = 9, [12] = 12, [13] = 16, [14] = 20, [15] = 25 },
    [6] = { [5] = 1, [6] = 1.5, [7] = 2, [8] = 3, [9] = 4, [10] = 6, [11] = 8, [12] = 10, [13] = 14, [14] = 18, [15] = 22 },
    [7] = { [5] = 0.8, [6] = 1.2, [7] = 1.8, [8] = 2.5, [9] = 3.5, [10] = 5, [11] = 7, [12] = 9, [13] = 12, [14] = 16, [15] = 20 },
}

local SCATTER_PROBS_BASE = {
    { count = 7, cum_prob = 0.000001 },
    { count = 6, cum_prob = 0.000009 },
    { count = 5, cum_prob = 0.0000475 },
    { count = 4, cum_prob = 0.0002475 },
    { count = 3, cum_prob = 0.003105 },
}

local SCATTER_PROBS_FREESPINS = {
    { count = 7, cum_prob = 0.0000002 },
    { count = 6, cum_prob = 0.000002 },
    { count = 5, cum_prob = 0.00001 },
    { count = 4, cum_prob = 0.00005 },
    { count = 3, cum_prob = 0.0007 },
}

local BONUS_BUY_SCATTER_WEIGHTS = {
    { count = 3, weight = 70 },
    { count = 4, weight = 18 },
    { count = 5, weight = 8 },
    { count = 6, weight = 3 },
    { count = 7, weight = 1 },
}

local function clamp(value, min_value, max_value)
    if value < min_value then
        return min_value
    end
    if value > max_value then
        return max_value
    end
    return value
end

local function create_multiplier_grid()
    local spots = {}
    for i = 1, TOTAL_CELLS do
        spots[i] = { hitCount = 0, value = 0 }
    end
    return spots
end

local function clone_multiplier_grid(spots)
    local clone = {}
    for i = 1, TOTAL_CELLS do
        local source = spots[i] or { hitCount = 0, value = 0 }
        clone[i] = { hitCount = source.hitCount or 0, value = source.value or 0 }
    end
    return clone
end

local function initialize_super_mode(spots)
    for i = 1, TOTAL_CELLS do
        spots[i].hitCount = 2
        spots[i].value = MULTIPLIER_BASE
    end
end

local function total_weight(pool)
    local total = 0
    for _, entry in ipairs(pool) do
        total = total + entry.weight
    end
    return total
end

local function weighted_pick(pool)
    local r = engine.random_float() * total_weight(pool)
    for _, entry in ipairs(pool) do
        r = r - entry.weight
        if r <= 0 then
            return entry.id
        end
    end
    return pool[#pool].id
end

local function row_of(index)
    return math.floor(index / GRID_COLS)
end

local function col_of(index)
    return index % GRID_COLS
end

local function make_cell(symbol_id, index)
    return {
        id = SYMBOL_KEYS[symbol_id],
        row = row_of(index),
        col = col_of(index),
    }
end

local function build_payload_grid(grid)
    local payload = {}
    for index = 0, TOTAL_CELLS - 1 do
        payload[#payload + 1] = make_cell(grid[index + 1], index)
    end
    return payload
end

local function get_cluster_payout(symbol_id, cluster_size)
    local table_for_symbol = CLUSTER_PAYOUTS[symbol_id]
    if table_for_symbol == nil or cluster_size < MIN_CLUSTER_SIZE then
        return 0
    end
    return table_for_symbol[math.min(cluster_size, 15)] or 0
end

local function roll_scatter_count(is_free_spins, scatter_boost)
    local table_ref = is_free_spins and SCATTER_PROBS_FREESPINS or SCATTER_PROBS_BASE
    local roll = engine.random_float()
    for _, entry in ipairs(table_ref) do
        local probability = entry.cum_prob
        if scatter_boost ~= nil and scatter_boost > 1 then
            probability = math.min(entry.cum_prob * scatter_boost, 0.99)
        end
        if roll < probability then
            return entry.count
        end
    end
    return 0
end

local function shuffle_columns(columns)
    for i = #columns, 2, -1 do
        local j = engine.random(1, i)
        columns[i], columns[j] = columns[j], columns[i]
    end
end

local function choose_scatter_positions(scatter_count)
    local positions = {}
    if scatter_count <= 0 then
        return positions
    end

    local columns = {}
    for col = 0, GRID_COLS - 1 do
        columns[#columns + 1] = col
    end
    shuffle_columns(columns)

    local limit = math.min(scatter_count, GRID_COLS)
    for i = 1, limit do
        local col = columns[i]
        local row = engine.random(0, GRID_ROWS - 1)
        positions[row * GRID_COLS + col] = true
    end
    return positions
end

local function generate_grid(allow_scatter, is_free_spins, scatter_boost, forced_scatter_count)
    local grid = {}
    local scatter_positions = {}

    if allow_scatter then
        local scatter_count = forced_scatter_count or roll_scatter_count(is_free_spins, scatter_boost or 1)
        scatter_positions = choose_scatter_positions(scatter_count)
    end

    for index = 0, TOTAL_CELLS - 1 do
        if scatter_positions[index] then
            grid[index + 1] = SCATTER_ID
        else
            grid[index + 1] = weighted_pick(REEL_SYMBOLS)
        end
    end

    return grid
end

local function count_scatters(grid)
    local count = 0
    for i = 1, #grid do
        if grid[i] == SCATTER_ID then
            count = count + 1
        end
    end
    return count
end

local function find_clusters(grid)
    local visited = {}
    local clusters = {}

    for start_index = 0, TOTAL_CELLS - 1 do
        if not visited[start_index] then
            local symbol_id = grid[start_index + 1]
            if symbol_id ~= SCATTER_ID then
                local queue = { start_index }
                local head = 1
                local cluster_positions = {}
                visited[start_index] = true

                while head <= #queue do
                    local index = queue[head]
                    head = head + 1
                    cluster_positions[#cluster_positions + 1] = index

                    local row = row_of(index)
                    local col = col_of(index)
                    local neighbors = {}
                    if row > 0 then
                        neighbors[#neighbors + 1] = (row - 1) * GRID_COLS + col
                    end
                    if row < GRID_ROWS - 1 then
                        neighbors[#neighbors + 1] = (row + 1) * GRID_COLS + col
                    end
                    if col > 0 then
                        neighbors[#neighbors + 1] = row * GRID_COLS + (col - 1)
                    end
                    if col < GRID_COLS - 1 then
                        neighbors[#neighbors + 1] = row * GRID_COLS + (col + 1)
                    end

                    for _, neighbor in ipairs(neighbors) do
                        if not visited[neighbor] and grid[neighbor + 1] == symbol_id then
                            visited[neighbor] = true
                            queue[#queue + 1] = neighbor
                        end
                    end
                end

                if #cluster_positions >= MIN_CLUSTER_SIZE then
                    clusters[#clusters + 1] = {
                        symbolId = SYMBOL_KEYS[symbol_id],
                        symbolNumericId = symbol_id,
                        positions = cluster_positions,
                        size = #cluster_positions,
                    }
                end
            end
        end
    end

    return clusters
end

local function get_winning_positions(clusters)
    local result = {}
    local seen = {}
    for _, cluster in ipairs(clusters) do
        for _, position in ipairs(cluster.positions) do
            if not seen[position] then
                seen[position] = true
                result[#result + 1] = position
            end
        end
    end
    return result, seen
end

local function register_hit(spots, position)
    local spot = spots[position + 1]
    local previous_value = spot.value
    spot.hitCount = spot.hitCount + 1

    if spot.hitCount == 1 then
        spot.value = 0
    elseif spot.hitCount == 2 then
        spot.value = MULTIPLIER_BASE
    else
        spot.value = clamp(spot.value * 2, 0, MULTIPLIER_MAX)
    end

    return {
        position = position,
        newValue = spot.value,
        previousValue = previous_value,
    }
end

local function register_positions(spots, positions)
    local changes = {}
    for _, position in ipairs(positions) do
        changes[#changes + 1] = register_hit(spots, position)
    end
    return changes
end

local function get_cluster_multiplier(spots, positions)
    local total = 0
    for _, position in ipairs(positions) do
        local value = (spots[position + 1] or {}).value or 0
        if value > 0 then
            total = total + value
        end
    end
    if total > 0 then
        return total
    end
    return 1
end

local function cascade_grid(grid, positions_to_remove)
    local next_grid = {}
    for i = 1, TOTAL_CELLS do
        next_grid[i] = grid[i]
    end

    for position, should_remove in pairs(positions_to_remove) do
        if should_remove then
            next_grid[position + 1] = nil
        end
    end

    for col = 0, GRID_COLS - 1 do
        local column_symbols = {}
        for row = GRID_ROWS - 1, 0, -1 do
            local index = row * GRID_COLS + col
            local symbol_id = next_grid[index + 1]
            if symbol_id ~= nil then
                column_symbols[#column_symbols + 1] = symbol_id
            end
        end

        for row = GRID_ROWS - 1, 0, -1 do
            local index = row * GRID_COLS + col
            local fill_index = GRID_ROWS - row
            if fill_index <= #column_symbols then
                next_grid[index + 1] = column_symbols[fill_index]
            else
                next_grid[index + 1] = weighted_pick(REEL_SYMBOLS)
            end
        end
    end

    return next_grid
end

local function roll_bonus_buy_scatter_count()
    local total = 0
    for _, entry in ipairs(BONUS_BUY_SCATTER_WEIGHTS) do
        total = total + entry.weight
    end

    local roll = engine.random_float() * total
    for _, entry in ipairs(BONUS_BUY_SCATTER_WEIGHTS) do
        roll = roll - entry.weight
        if roll <= 0 then
            return entry.count
        end
    end

    return BONUS_BUY_SCATTER_WEIGHTS[#BONUS_BUY_SCATTER_WEIGHTS].count
end

local function build_cluster_payload(cluster)
    return {
        symbolId = cluster.symbolId,
        positions = cluster.positions,
        size = cluster.size,
    }
end

local function resolve_spin(bet, options)
    local multiplier_spots = options.multiplier_spots or create_multiplier_grid()
    local running_total = options.running_total or 0
    local is_free_spins = options.is_free_spins or false
    local scatter_boost = options.scatter_boost or 1
    local forced_scatter_count = options.forced_scatter_count

    local grid = generate_grid(true, is_free_spins, scatter_boost, forced_scatter_count)
    local initial_scatter_count = count_scatters(grid)
    local cascade_steps = {}
    local total_win = 0
    local max_win_reached = false

    while true do
        local clusters = find_clusters(grid)
        if #clusters == 0 then
            cascade_steps[#cascade_steps + 1] = {
                grid = build_payload_grid(grid),
                clusters = {},
                winAmount = 0,
                removedPositions = {},
                multiplierChanges = {},
                clusterDetails = {},
                multiplierSnapshot = clone_multiplier_grid(multiplier_spots),
            }
            break
        end

        local removed_positions, removed_lookup = get_winning_positions(clusters)
        local multiplier_changes = register_positions(multiplier_spots, removed_positions)
        local cluster_details = {}
        local step_win = 0

        for _, cluster in ipairs(clusters) do
            local base_payout = get_cluster_payout(cluster.symbolNumericId, cluster.size) * bet * RTP_FACTOR
            local multiplier = get_cluster_multiplier(multiplier_spots, cluster.positions)
            local total_payout = base_payout * multiplier
            step_win = step_win + total_payout

            cluster_details[#cluster_details + 1] = {
                cluster = build_cluster_payload(cluster),
                basePayout = base_payout,
                multiplier = multiplier,
                totalPayout = total_payout,
            }
        end

        total_win = total_win + step_win

        cascade_steps[#cascade_steps + 1] = {
            grid = build_payload_grid(grid),
            clusters = (function()
                local payload = {}
                for _, cluster in ipairs(clusters) do
                    payload[#payload + 1] = build_cluster_payload(cluster)
                end
                return payload
            end)(),
            winAmount = step_win,
            removedPositions = removed_positions,
            multiplierChanges = multiplier_changes,
            clusterDetails = cluster_details,
            multiplierSnapshot = clone_multiplier_grid(multiplier_spots),
        }

        if bet > 0 and ((running_total + total_win) / bet) >= MAX_WIN_MULTIPLIER then
            total_win = MAX_WIN_MULTIPLIER * bet - running_total
            max_win_reached = true
            break
        end

        grid = cascade_grid(grid, removed_lookup)
    end

    local free_spins_awarded = 0
    for count = 3, 7 do
        if initial_scatter_count >= count and FREE_SPINS_TABLE[count] ~= nil then
            free_spins_awarded = FREE_SPINS_TABLE[count]
        end
    end

    return {
        cascadeSteps = cascade_steps,
        totalWin = total_win,
        totalWinMultiplier = bet > 0 and (total_win / bet) or 0,
        scatterCount = initial_scatter_count,
        freeSpinsAwarded = free_spins_awarded,
        maxWinReached = max_win_reached,
    }
end

local function parse_number(value, fallback)
    if value == nil then
        return fallback
    end
    return value
end

local function read_persisted_number(state, variable_name, param_name, fallback)
    local variables = state.variables or {}
    local params = state.params or {}
    local variable_value = variables[variable_name]
    if variable_value ~= nil then
        return parse_number(variable_value, fallback)
    end
    return parse_number(params[param_name], fallback)
end

local function restore_multiplier_grid(state)
    local persisted = state.params and state.params._ps_multiplier_spots
    if persisted == nil then
        return create_multiplier_grid()
    end

    local spots = create_multiplier_grid()
    for i = 1, math.min(#persisted, TOTAL_CELLS) do
        local source = persisted[i] or {}
        spots[i].hitCount = parse_number(source.hitCount, 0)
        spots[i].value = parse_number(source.value, 0)
    end
    return spots
end

local function build_spin_response(result, scatter_boost, variables, persist)
    local response = {
        total_win = variables.bet_value > 0 and (result.totalWin / variables.bet_value) or 0,
        kind = "spin",
        spinResult = result,
        scatterBoost = scatter_boost,
        variables = variables.values,
    }

    if persist ~= nil then
        response._persist_multiplier_spots = persist.multiplier_spots
        response._persist_free_spins_total_win = persist.free_spins_total_win
        response._persist_free_spins_scatter_boost = persist.free_spins_scatter_boost
        response._persist_free_spins_super_mode = persist.free_spins_super_mode
    end

    return response
end

local function do_base_game(state)
    local action = state.action or (state.params and state.params._action) or "spin"
    local bet = parse_number(state.variables and state.variables.bet, 0)

    if action == "buy_bonus" or action == "buy_bonus_super" then
        local super_mode = action == "buy_bonus_super"
        local scatter_count = roll_bonus_buy_scatter_count()
        local free_spins_awarded = FREE_SPINS_TABLE[scatter_count] or 10
        local scatter_boost = super_mode and FS_SCATTER_BOOST_SUPER or FS_SCATTER_BOOST_STANDARD
        local multiplier_spots = create_multiplier_grid()
        if super_mode then
            initialize_super_mode(multiplier_spots)
        end

        return {
            total_win = 0,
            kind = "buy_bonus",
            bonus = {
                bonusGrid = build_payload_grid(generate_grid(true, false, 1, scatter_count)),
                scatterCount = scatter_count,
                freeSpinsAwarded = free_spins_awarded,
                superMode = super_mode,
                scatterBoost = scatter_boost,
            },
            variables = {
                free_spins_remaining = free_spins_awarded,
                free_spins_scatter_boost = scatter_boost,
                free_spins_total_win = 0,
                free_spins_super_mode = super_mode and 1 or 0,
            },
            _persist_multiplier_spots = multiplier_spots,
            _persist_free_spins_total_win = 0,
            _persist_free_spins_scatter_boost = scatter_boost,
            _persist_free_spins_super_mode = super_mode and 1 or 0,
        }
    end

    local result = resolve_spin(bet, {
        multiplier_spots = create_multiplier_grid(),
        running_total = 0,
        is_free_spins = false,
        scatter_boost = 1,
    })

    local values = {}
    if result.freeSpinsAwarded > 0 then
        values.free_spins_remaining = result.freeSpinsAwarded
        values.free_spins_scatter_boost = 1
        values.free_spins_total_win = 0
        values.free_spins_super_mode = 0
    end
    if result.maxWinReached then
        values.max_win_reached = 1
    end

    local persist = nil
    if result.freeSpinsAwarded > 0 and not result.maxWinReached then
        persist = {
            multiplier_spots = create_multiplier_grid(),
            free_spins_total_win = 0,
            free_spins_scatter_boost = 1,
            free_spins_super_mode = 0,
        }
    end

    return build_spin_response(result, 1, {
        bet_value = bet,
        values = values,
    }, persist)
end

local function do_free_spin(state)
    local bet = parse_number(state.variables and state.variables.bet, 0)
    local scatter_boost = read_persisted_number(state, "free_spins_scatter_boost", "_ps_free_spins_scatter_boost", 1)
    local running_total = read_persisted_number(state, "free_spins_total_win", "_ps_free_spins_total_win", 0)
    local super_mode = read_persisted_number(state, "free_spins_super_mode", "_ps_free_spins_super_mode", 0)
    local multiplier_spots = restore_multiplier_grid(state)

    if super_mode == 1 then
        local has_state = false
        for i = 1, TOTAL_CELLS do
            if multiplier_spots[i].hitCount > 0 or multiplier_spots[i].value > 0 then
                has_state = true
                break
            end
        end
        if not has_state then
            initialize_super_mode(multiplier_spots)
        end
    end

    local result = resolve_spin(bet, {
        multiplier_spots = multiplier_spots,
        running_total = running_total,
        is_free_spins = true,
        scatter_boost = scatter_boost,
    })

    local updated_total = running_total + result.totalWin
    local values = {
        retrigger_spins = result.freeSpinsAwarded,
        free_spins_scatter_boost = scatter_boost,
        free_spins_total_win = updated_total,
        free_spins_super_mode = super_mode,
    }
    if result.maxWinReached then
        values.max_win_reached = 1
    end

    return build_spin_response(result, scatter_boost, {
        bet_value = bet,
        values = values,
    }, {
        multiplier_spots = multiplier_spots,
        free_spins_total_win = updated_total,
        free_spins_scatter_boost = scatter_boost,
        free_spins_super_mode = super_mode,
    })
end

function execute(state)
    local stage = state.stage or "base_game"

    if stage == "base_game" then
        return do_base_game(state)
    elseif stage == "free_spins" then
        return do_free_spin(state)
    end

    error("unknown stage: " .. tostring(stage))
end
// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import assert from 'assert';
import * as Tp from 'thingpedia';
import { Ast, SchemaRetriever } from 'thingtalk';

import * as I18n from '../i18n';
import { cleanKind } from '../utils/misc-utils';
import { shouldAutoConfirmStatement } from '../utils/thingtalk';
import { contactSearch, Contact } from './entity-linking/contact_search';
import { collectDisambiguationHints, getBestEntityMatch, EntityRecord } from './entity-linking/entity-finder';

import { CancellationError } from './errors';
import ValueCategory from './value-category';

interface AbstractDialogueAgentOptions {
    locale : string;
    timezone : string;
    debug : boolean;
}

type RawExecutionResult = Array<[string, Record<string, unknown>]>;
interface AbstractStatementExecutor<PrivateStateType> {
    executeStatement(stmt : Ast.ExpressionStatement, privateState : PrivateStateType|undefined) :
        Promise<[Ast.DialogueHistoryResultList, RawExecutionResult, PrivateStateType]>;
}

export interface DisambiguationHints {
    devices : Map<string, [string|null, Ast.InputParam|undefined]>;
    idEntities : Map<string, EntityRecord[]>;
    previousLocations : Ast.AbsoluteLocation[];
}

export interface DeviceInfo {
    kind : string;
    uniqueId : string;
    name : string;
}

interface ExecutionResult<PrivateStateType> {
    newDialogueState : Ast.DialogueState;
    newExecutorState : PrivateStateType|undefined;
    newResults : Array<[string, Record<string, unknown>]>;
    anyChange : boolean;
}

class UsesParamVisitor extends Ast.NodeVisitor {
    used = false;
    constructor(private pname : string) {
        super();
    }

    visitExternalBooleanExpression() {
        // do not recurse
        return false;
    }
    visitValue() {
        // do not recurse
        return false;
    }

    visitAtomBooleanExpression(atom : Ast.AtomBooleanExpression) {
        this.used = this.used ||
            (this.pname === atom.name && atom.operator === '=~');
        return true;
    }
}

function expressionUsesIDFilter(expr : Ast.Expression) {
    const visitor = new UsesParamVisitor('id');
    expr.visit(visitor);
    return visitor.used;
}

/**
 * Base class of a dialogue agent.
 *
 * The class contains the code that is common between execution (aka inference time)
 * and simulation (aka training time).
 * Because it is used for simulation, the class is completely stateless
 *
 * The public API of this class is used by the entity linking & device choice code
 * (during the "prepare for execution" step) to abstract the access to the "user".
 *
 * There are two subclasses, one used during simulation, and one used for execution.
 */
export default abstract class AbstractDialogueAgent<PrivateStateType> {
    protected _tpClient : Tp.BaseClient;
    protected _schemas : SchemaRetriever;
    protected _debug : boolean;
    private _langPack : I18n.LanguagePack;
    locale : string;
    timezone : string;

    constructor(tpClient : Tp.BaseClient, schemas : SchemaRetriever, options : AbstractDialogueAgentOptions) {
        this._tpClient = tpClient;
        this._schemas = schemas;
        this._langPack = I18n.get(options.locale);

        this._debug = options.debug;
        this.locale = options.locale;
        this.timezone = options.timezone;
    }

    /**
     * Execute the query or action implied by the current dialogue state.
     *
     * This method should return a new dialogue state with filled information
     * about the result. It should not modify the state in-place.
     *
     * This is the only public method in this class.
     *
     * @param {Ast.DialogueState} state - the current state, representing the query or action to execute
     * @param {any} privateState - additional state carried by the dialogue agent (per dialogue)
     * @return {Ast.DialogueState} - the new state, with information about the returned query or action
     */
    async execute(state : Ast.DialogueState, privateState : PrivateStateType|undefined) : Promise<ExecutionResult<PrivateStateType>> {
        let anyChange = false;
        let clone = state;

        const newResults : RawExecutionResult = [];
        const hints = this._collectDisambiguationHintsForState(state);
        for (let i = 0; i < clone.history.length; i++) {
            if (clone.history[i].results !== null)
                continue;

            if (!anyChange) {
                clone = state.clone();
                anyChange = true;
            }
            // prepare for execution now, even if we don't execute yet
            // so we slot-fill eagerly
            await this._prepareForExecution(clone.history[i].stmt, hints);

            if (clone.history[i].confirm === 'accepted' &&
                clone.history[i].isExecutable() &&
                shouldAutoConfirmStatement(clone.history[i].stmt))
                clone.history[i].confirm = 'confirmed';
            if (clone.history[i].confirm !== 'confirmed')
                continue;
            assert(clone.history[i].isExecutable());

            const [newResultList, newRawResult, newPrivateState] = await this.executor.executeStatement(clone.history[i].stmt, privateState);
            clone.history[i].results = newResultList;
            newResults.push(...newRawResult);
            privateState = newPrivateState;
        }

        return { newDialogueState: clone, newExecutorState: privateState, newResults, anyChange };
    }

    private _collectDisambiguationHintsForState(state : Ast.DialogueState) {
        const idEntities = new Map<string, EntityRecord[]>();
        const devices = new Map<string, [string|null, Ast.InputParam|undefined]>();
        const previousLocations : Ast.AbsoluteLocation[] = [];

        // collect all ID entities and all locations from the state
        for (const item of state.history) {
            const results = item.results;
            if (results === null)
                continue;

            for (const slot of item.stmt.iterateSlots2()) {
                if (slot instanceof Ast.DeviceSelector)
                    devices.set(slot.kind, [slot.id, slot.getAttribute('name')]);
            }

            for (const result of results.results)
                collectDisambiguationHints(result, idEntities, previousLocations);
        }

        return { devices, idEntities, previousLocations };
    }

    /**
     * Prepare a statement for being executed.
     *
     * This will resolve all ThingTalk values that are relative to the user, such as
     * `$context.location.current_location`, and will assign device IDs to all Thingpedia
     * function calls.
     *
     * The statement is modified in place.
     *
     * @param {thingtalk.Ast.Statement} stmt - the statement to prepare
     * @param {any} hints - hints to use to resolve any ambiguity
     */
    protected async _prepareForExecution(stmt : Ast.ExpressionStatement, hints : DisambiguationHints) : Promise<void> {
        // somewhat of a HACK:
        // add a [1] clause to immediate-mode statements that refer to "id" in
        // the query and don't have an index clause already
        // we add the clause to all expressions except the last one
        // that way, if we have an action, it will be performed on the first
        // result only, but if we don't have an action, we'll return all results
        // that match

        for (let i = 0; i < stmt.expression.expressions.length-1; i++) {
            const expr = stmt.expression.expressions[i];
            if (expr.schema!.functionType !== 'action' &&
                expressionUsesIDFilter(expr) && !(expr instanceof Ast.IndexExpression) &&
                !(expr instanceof Ast.SliceExpression))
                stmt.expression.expressions[i] = new Ast.IndexExpression(null, expr, [new Ast.Value.Number(1)], expr.schema).optimize();
        }

        // FIXME this method can cause a few questions that
        // bypass the neural network, which is not great
        //
        // In particular, the following questions need to be fixed:
        // - "Who do you want to contact?" (from contact_search)
        // - "Where are you now?" / "What is your home address?" ... (from user_context)
        //
        // OTOH, questions that use "askChoices" or raw mode are fine,
        // because those are intentionally skipping the neural network
        //
        // (OTOOH, a proper IoT skill would probably use a more conversational
        // model for device choice, so the user can say "use the light in this room"
        // or "use the light closest to me", or similar)

        stmt.visit(new class extends Ast.NodeVisitor {
            visitInvocation(invocation : Ast.Invocation) {
                const set = new Set;
                for (const inParam of invocation.in_params)
                    set.add(inParam.name);

                for (const arg of invocation.schema!.iterateArguments()) {
                    if (arg.is_input && !arg.required && arg.impl_annotations.default && !set.has(arg.name))
                        invocation.in_params.push(new Ast.InputParam(null, arg.name, arg.impl_annotations.default));
                }
                return false;
            }
        });

        for (const slot of stmt.iterateSlots2()) {
            if (slot instanceof Ast.DeviceSelector)
                await this._chooseDevice(slot, hints);
            else
                await this._concretizeValue(slot, hints);
        }
    }

    /**
     * Show a debug message.
     *
     * @param {any} msg - what to show
     * @protected
     */
    debug(...args : unknown[]) : void {
        if (!this._debug)
            return;
        console.log(...args);
    }

    private async _chooseDevice(selector : Ast.DeviceSelector, hints : DisambiguationHints) : Promise<void> {
        function like(str : string, substr : string) : boolean {
            if (!str)
                return false;
            return str.toLowerCase().indexOf(substr.toLowerCase()) >= 0;
        }

        if (selector.id !== null)
            return;

        const kind = selector.kind;
        const name = selector.getAttribute('name');
        if (hints.devices.has(kind) && !selector.all) {
            // if we have already selected a device for this kind in the context, reuse what
            // we chose before without asking again
            const [previousId, previousName] = hints.devices.get(kind)!;
            selector.id = previousId;
            if (name && previousName)
                name.value = previousName.value;
            else if (previousName)
                selector.attributes.push(previousName.clone());
            return;
        }

        const alldevices = this.getAllDevicesOfKind(kind);

        if (alldevices.length === 0) {
            this.debug('No device of kind ' + kind + ' available, attempting configure...');
            const device = await this.tryConfigureDevice(kind);
            if (!device) // cancel the dialogue if we failed to set up a device
                throw new CancellationError();
            if (selector.all)
                return;
            selector.id = device.uniqueId;
            if (name)
                name.value = new Ast.Value.String(device.name);
            else
                selector.attributes.push(new Ast.InputParam(null, 'name', new Ast.Value.String(device.name)));
            return;
        }

        if (selector.all)
            return;

        let selecteddevices = alldevices;
        if (name !== undefined)
            selecteddevices = alldevices.filter((d) => like(d.name, name.value.toJS() as string));

        // TODO let the user choose if multiple devices match...
        if (selecteddevices.length >= 1) {
            selector.id = selecteddevices[0].uniqueId;
            if (name)
                name.value = new Ast.Value.String(selecteddevices[0].name);
            else
                selector.attributes.push(new Ast.InputParam(null, 'name', new Ast.Value.String(selecteddevices[0].name)));
            return;
        }

        const choosefrom = (selecteddevices.length ? selecteddevices : alldevices);
        const choice = await this.disambiguate('device',
            selecteddevices.length && name ? name.value.toJS() as string : null, choosefrom.map((d) => d.name), kind);
        selector.id = choosefrom[choice].uniqueId;
        if (name)
            name.value = new Ast.Value.String(choosefrom[0].name);
        else
            selector.attributes.push(new Ast.InputParam(null, 'name', new Ast.Value.String(choosefrom[0].name)));
    }

    private async _addDisplayToDevice(value : Ast.EntityValue) : Promise<void> {
        try {
            const classDef = await this._schemas.getFullMeta(value.value!);

            value.display = classDef.metadata.thingpedia_name || classDef.metadata.canonical || cleanKind(value.value!);
        } catch(e) {
            /* ignore if the device does not exist, it might be a constant of the form
               "str:ENTITY_tt:device::" */
        }
    }

    private async _maybeAddDisplayToValue(value : Ast.EntityValue) : Promise<void> {
        switch (value.type) {
        case 'tt:contact':
            await this.addDisplayToContact(value);
            break;

        case 'tt:device':
            await this._addDisplayToDevice(value);
            break;
        }
    }

    private async _concretizeValue(slot : Ast.AbstractSlot, hints : DisambiguationHints) : Promise<void> {
        let value = slot.get();

        // default units (e.g. defaultTemperature) will be concretized
        // according to the user's preferences or locale
        // since dlg.locale is overwritten to be en-US, we infer the locale
        // via other environment variables like LANG (language) or TZ (timezone)
        if (value instanceof Ast.MeasureValue && value.unit.startsWith('default')) {
            const key = value.unit.substring('default'.length).toLowerCase();
            const preference = this.getPreferredUnit(key);
            if (preference)
                value.unit = preference;

            switch (key) {
            case 'defaultTemperature':
                value.unit = this._langPack.getDefaultTemperatureUnit();
            default:
                throw new TypeError('Unexpected default unit ' + value.unit);
            }
        } else if (value instanceof Ast.LocationValue && value.value instanceof Ast.UnresolvedLocation) {
            slot.set(await this.lookupLocation(value.value.name, hints.previousLocations || []));
        } else if (value instanceof Ast.LocationValue && value.value instanceof Ast.RelativeLocation) {
            slot.set(await this.resolveUserContext('$context.location.' + value.value.relativeTag));
        } else if (value instanceof Ast.TimeValue && value.value instanceof Ast.RelativeTime) {
            slot.set(await this.resolveUserContext('$context.time.' + value.value.relativeTag));
        } else if (value instanceof Ast.EntityValue && value.value === null) {
            if (value.type === 'tt:email_address' || value.type === 'tt:phone_number' ||
                value.type === 'tt:contact') {
                slot.set(await contactSearch(this, value.type, value.display!));
            } else if (value.type === 'tt:device') {
                const candidates = await this._tpClient.searchDevice(value.display!);
                const tokenizer = this._langPack.getTokenizer();
                const resolved = getBestEntityMatch(value.display!, value.type, candidates.map((d) => ({
                    value: d.primary_kind,
                    name: d.name,
                    canonical: tokenizer.tokenize(d.name).rawTokens.join(' ')
                })));
                value.value = resolved.value;
                value.display = resolved.name;
            } else {
                const candidates = (hints.idEntities ? hints.idEntities.get(value.type) : undefined)
                    || await this.lookupEntityCandidates(value.type, value.display!, hints);
                const resolved = getBestEntityMatch(value.display!, value.type, candidates);
                value.value = resolved.value;
                value.display = resolved.name;
            }
        }

        value = slot.get();
        assert(value.isConcrete());
        if (value instanceof Ast.EntityValue && !value.display)
            await this._maybeAddDisplayToValue(value);
    }

    // The rest is the API that subclasses must implement

    /* instanbul ignore next */
    /**
     * Retrieve the executor to use for each statement.
     */
    protected get executor() : AbstractStatementExecutor<PrivateStateType> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * List all configured devices that implement the given ThingTalk kind.
     *
     * @param {string} kind - the kind to check
     * @returns {Array<DeviceInfo>} - the list of configured devices
     * @abstract
     */
    protected getAllDevicesOfKind(kind : string) : DeviceInfo[] {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Attempt to automatically configure a device of the given kind.
     *
     * @param {string} kind - the kind to configure
     * @returns {DeviceInfo} - the newly configured device
     */
    protected async tryConfigureDevice(kind : string) : Promise<DeviceInfo|null> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Disambiguate an entity by explicitly asking the user.
     *
     * @param {string} type - the type of disambiguation to perform, either `device`, `contact`,
     *   or `entity`
     * @param {string} name - the name to disambiguate
     * @param {string[]} choices - the choices among which to disambiguate
     * @param {string} hint - a type-specific hint to show to the user
     * @returns {number} - the index of the provided choice
     */
    async disambiguate(type : 'device'|'contact',
                       name : string|null,
                       choices : string[],
                       hint ?: string) : Promise<number> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Lookup a contact in the address book.
     *
     * @param {ValueCategory} category - the category of information to look up
     * @param {string} name - the name to look up
     * @returns {string[]} - the list of resolved information of all contacts matching the name
     */
    async lookupContact(category : ValueCategory, name : string) : Promise<Contact[]> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Add the display field to a phone or email entity, by looking up the contact in the address book.
     *
     * @param {thingtalk.Ast.Value} contact - the entity to look up
     */
    protected async addDisplayToContact(contact : Ast.EntityValue) : Promise<void> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Ask the user about a contact that is not in the address book.
     *
     * @param {ValueCategory} category - the category of information to look up
     * @param {string} name - the name to look up
     * @returns {thingtalk.Ast.Value.Entity} - the entity corresponding to the picked up information
     */
    async askMissingContact(category : ValueCategory.EmailAddress|ValueCategory.PhoneNumber|ValueCategory.Contact,
                            name : string) : Promise<Ast.EntityValue> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Resolve a location name to a specific point on Earth.
     *
     * @param {string} searchKey - the location name to look up
     * @param {thingtalk.Ast.Location[]} previousLocations - recently mentioned locations
     * @returns {thingtalk.Ast.Value} - the best match for the given name
     */
    protected async lookupLocation(searchKey : string, previousLocations : Ast.AbsoluteLocation[]) : Promise<Ast.LocationValue> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Lookup all possible candidates for a given entity in the Thingpedia database or
     * by calling the underlying API.
     *
     * @param {string} entityType - the type of entity to look up
     * @param {string} entityDisplay - the display name of the entity look up
     * @param {any} hints - hints to use to resolve any ambiguity
     * @returns {ThingpediaEntity[]} - possible entities that match the given name, in Thingpedia API format
     * @abstract
     * @protected
     */
    protected async lookupEntityCandidates(entityType : string,
                                           entityDisplay : string,
                                           hints : DisambiguationHints) : Promise<EntityRecord[]> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Resolve a `$context` variable to a concrete value.
     *
     * @param {string} variable - the variable name to lookup, including the `$context.` prefix
     * @returns {thingtalk.Ast.Value} - the resolved value
     * @abstract
     * @protected
     */
    protected async resolveUserContext(variable : string) : Promise<Ast.Value> {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Compute the user's preferred unit to use when the program specifies an ambiguous unit
     * such as "degrees".
     *
     * @param {string} type - the type of unit to retrieve (e.g. "temperature"), or undefined
     *   if the user has no preference
     * @returns {string} - the preferred unit
     * @abstract
     * @protected
     */
    getPreferredUnit(type : string) : string|undefined {
        throw new TypeError('Abstract method');
    }
}

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
import { Ast, Type } from 'thingtalk';

import type Engine from '../engine';
import type { DeviceInfo } from '../engine';

import { cleanKind } from '../utils/misc-utils';
import ValueCategory from './value-category';
import StatementExecutor from './statement_executor';
import { CancellationError } from './errors';
import { EntityRecord } from './entity-linking/entity-finder';
import { Contact } from './entity-linking/contact_search';
import { PlatformData } from './user-input';

import AbstractDialogueAgent, {
    DisambiguationHints,
} from './abstract_dialogue_agent';

/**
 * The interface that the {@link ExecutionDialogueAgent} uses to communicate
 * with outside.
 *
 * In some code paths, {@link ExecutionDialogueAgent} needs to send messages
 * to the user or ask questions, in the middle of preparing for execution
 * and outside of the normal dialogue loop.
 *
 * It does so by calling this interface, which for the normal assistant is
 * implemented by {@link DialogueLoop}.
 *
 * TODO: This interface has some ugly inversion of control where the outside
 * code that drives the dialogue gets called synchronously by this code.
 * We should refactor all of this.
 */
export interface AbstractDialogueLoop {
    icon : string|null;
    platformData : PlatformData;
    isAnonymous : boolean;
    _ : (x : string) => string;

    reply(msg : string) : Promise<void>;
    replyLink(title : string, link : string) : Promise<void>;
    interpolate(msg : string, args : Record<string, unknown>) : string;
    replyInterp(msg : string, args : Record<string, unknown>) : Promise<void>;
    ask(expected : ValueCategory.PhoneNumber|ValueCategory.EmailAddress|ValueCategory.Location|ValueCategory.Time,
        question : string,
        args ?: Record<string, unknown>) : Promise<Ast.Value>;
    askChoices(question : string, choices : string[]) : Promise<number>;
}

/**
 * The execution time dialogue agent.
 *
 * Provides access to the real user's information, stored in the engine.
 */
export default class ExecutionDialogueAgent extends AbstractDialogueAgent<undefined> {
    private _engine : Engine;
    private _platform : Tp.BasePlatform;
    private _dlg : AbstractDialogueLoop;
    private _executor : StatementExecutor;

    constructor(engine : Engine, dlg : AbstractDialogueLoop, debug : boolean) {
        super(engine.thingpedia, engine.schemas, {
            debug: debug,
            locale: engine.platform.locale,
            timezone: engine.platform.timezone
        });

        this._engine = engine;
        this._platform = engine.platform;
        this._executor = new StatementExecutor(engine);
        this._dlg = dlg;
    }

    get _() {
        return this._dlg._;
    }
    get executor() {
        return this._executor;
    }

    getAllDevicesOfKind(kind : string) {
        return this._engine.getDeviceInfos(kind);
    }

    async disambiguate(type : 'device'|'contact',
                       name : string|null,
                       choices : string[],
                       hint ?: string) : Promise<number> {
        let question : string;
        if (type === 'device') {
            question = this._dlg.interpolate(this._("You have multiple ${?“${name}” }${device} devices. Which one do you want to use?"), {
                name,
                device: cleanKind(hint!)
            })!;
        } else {
            question = this._dlg.interpolate(this._("Multiple contacts match “${name}”. Who do you mean?"), { name })!;
        }
        return this._dlg.askChoices(question, choices);
    }

    protected async tryConfigureDevice(kind : string) : Promise<DeviceInfo|null> {
        const factories = await this._tpClient.getDeviceSetup([kind]);
        const factory = factories[kind];
        if (!factory) {
            await this._dlg.replyInterp(this._("You need to enable ${device} before you can use that command."), {
                device: cleanKind(kind)
            });
            await this._dlg.replyLink(this._dlg.interpolate(this._("Configure ${device}"), {
                device: cleanKind(kind)
            }), "/devices/create");
            return null;
        }

        if (factory.type === 'none') {
            const device = await this._engine.createDevice({ kind: factory.kind });
            return this._engine.getDeviceInfo(device.uniqueId!);
        } else {
            if (this._dlg.isAnonymous) {
                await this._dlg.replyInterp(this._("Sorry, to use ${device}, you must log in to your personal account."), {
                    device: factory.text,
                });
                await this._dlg.replyLink(this._("Register for Almond"), "/user/register");
                return null;
            }

            if (factory.type === 'multiple' && factory.choices.length === 0) {
                await this._dlg.replyInterp(this._("You need to enable ${device} before you can use that command."), {
                    device: factory.text
                });
            } else if (factory.type === 'multiple') {
                await this._dlg.replyInterp(this._("You do not have a ${device} configured. You will need to enable ${choices:disjunction} before you can use that command."), {
                    device: factory.text,
                    choices: factory.choices.map((f) => f.text)
                });
            } else if (this.getAllDevicesOfKind(factory.kind).length > 0) {
                await this._dlg.replyInterp(this._("You do not have a ${device} configured. You will need to configure it inside your ${factory} before you can use that command."), {
                    device: cleanKind(kind),
                    factory: factory.text,
                });
                // exit early without any button
                return null;
            } else {
                await this._dlg.replyInterp(this._("You need to enable ${device} before you can use that command."), {
                    device: factory.text
                });
            }

            // HACK: home assistant cannot be configured here, override the factory type
            if (factory.type !== 'multiple' && factory.kind === 'io.home-assistant')
                factory.type = 'interactive'; // this code is CHAOTIC EVIL as it exploits the unsoundness of TypeScript :D

            switch (factory.type) {
            case 'oauth2':
                await this._dlg.replyLink(this._dlg.interpolate(this._("Configure ${device}"), { device: factory.text }),
                    `/devices/oauth2/${factory.kind}?name=${encodeURIComponent(factory.text)}`);
                break;
            case 'multiple':
                await this._dlg.replyLink(this._("Configure a new skill"), "/devices/create");
                break;
            default:
                await this._dlg.replyLink(this._dlg.interpolate(this._("Configure ${device}"), { device: factory.text }), "/devices/create");
            }
            return null;
        }
    }

    async lookupContact(category : ValueCategory, name : string) : Promise<Contact[]> {
        if (this._dlg.platformData.contacts) {
            for (const platformContact of this._dlg.platformData.contacts) {
                if (platformContact.value === name) {
                    this.debug(`Mapped @${name} to ${platformContact.principal} using platform data`);
                    return [{
                        value: platformContact.principal,
                        displayName: platformContact.display
                    }];
                }
            }
        }

        const contactApi = this._platform.getCapability('contacts');
        if (contactApi === null)
            return [];

        let what : 'phone_number' | 'email_address' | 'contact';
        if (category === ValueCategory.PhoneNumber)
            what = 'phone_number';
        else if (category === ValueCategory.EmailAddress)
            what = 'email_address';
        else
            what = 'contact';
        return contactApi.lookup(what, name);
    }

    async askMissingContact(category : ValueCategory.EmailAddress|ValueCategory.PhoneNumber|ValueCategory.Contact,
                            name : string) : Promise<Ast.EntityValue> {
        await this._dlg.replyInterp(this._("No contact matches “${name}”."), { name });

        // straight up ask for the target category
        // this ensures we show a contact picker, which is better than
        // repeatedly asking the user
        const value = await this._dlg.ask(category === ValueCategory.Contact ? ValueCategory.PhoneNumber : category,
            this._("Who do you want to contact?"));
        assert(value instanceof Ast.EntityValue);
        return value;
    }

    protected async addDisplayToContact(contact : Ast.EntityValue) : Promise<void> {
        const principal = contact.value;
        if (!principal)
            return;

        if (this._dlg.platformData.contacts) {
            for (const platformContact of this._dlg.platformData.contacts) {
                if (platformContact.principal === principal) {
                    contact.display = platformContact.display;
                    return;
                }
            }
        }

        const contactApi = this._platform.getCapability('contacts');
        if (contactApi === null)
            return;

        const addressBookContact = await contactApi.lookupPrincipal(principal);
        if (addressBookContact)
            contact.display = addressBookContact.displayName;
    }

    private async _constructEntityQuery(kind : string, query : string, entityDisplay : string) {
        const schema = await this._schemas.getSchemaAndNames(kind, 'query', query);
        const filter = new Ast.BooleanExpression.Atom(null, 'id', '=~', new Ast.Value.String(entityDisplay));
        const invocation = (new Ast.Invocation(null, new Ast.DeviceSelector(null, kind, null, null), query, [], schema));
        const invocationTable = new Ast.InvocationExpression(null, invocation, schema);
        const filteredTable = new Ast.FilterExpression(null, invocationTable, filter, schema);
        return new Ast.ExpressionStatement(null, filteredTable);
    }

    protected async lookupEntityCandidates(entityType : string,
                                           entityDisplay : string,
                                           hints : DisambiguationHints) : Promise<EntityRecord[]> {
        // HACK this should be made generic with some new Genie annotation
        if (entityType === 'org.freedesktop:app_id') {
            const appLauncher = this._platform.getCapability('app-launcher');
            if (appLauncher)
                return appLauncher.listApps();
        }

        const { data: tpCandidates, meta } = await this._tpClient.lookupEntity(entityType, entityDisplay);
        if (tpCandidates.length > 0)
            return tpCandidates;

        let stmt;
        try {
            const kind = entityType.split(":")[0];
            const query = entityType.split(":")[1];
            stmt = await this._constructEntityQuery(kind, query, entityDisplay);
        } catch(e) {
            // ignore an error here (it indicates the query is not an ID query)
        }

        let candidates = tpCandidates;
        if (stmt) {
            await this._prepareForExecution(stmt, hints);
            const [results,] = await this._executor.executeStatement(stmt);
            candidates = [];
            for (const item of results!.results) {
                const id = item.value.id;
                if (!id || !(id instanceof Ast.EntityValue))
                    continue;

                const entity = {
                    type: entityType,
                    value: id.value!,
                    canonical: id.display!.toLowerCase(),
                    name: id.display!
                };
                candidates.push(entity);
            }
        }

        if (candidates.length === 0) {
            await this._dlg.replyInterp(this._("Sorry, I cannot find any ${entity_type} matching “${name}”."), {
                entity_type: meta.name,
                name: entityDisplay
            });
            throw new CancellationError();
        }
        return candidates;
    }

    private async _tryGetCurrentLocation() : Promise<Ast.AbsoluteLocation|null> {
        const gps = this._platform.getCapability('gps');
        if (gps === null)
            return null;
        const location = await gps.getCurrentLocation();
        if (location === null) {
            this.debug('GPS location not available');
            return null;
        } else {
            return new Ast.Location.Absolute(location.latitude, location.longitude, location.display||null);
        }
    }

    protected async lookupLocation(searchKey : string, previousLocations : Ast.AbsoluteLocation[]) : Promise<Ast.LocationValue> {
        const currentLocation = await this._tryGetCurrentLocation();
        const lastLocation = previousLocations.length ? previousLocations[previousLocations.length - 1] : undefined;

        let around;
        if (lastLocation)
            around = { latitude: lastLocation.lat, longitude: lastLocation.lon };
        else if (currentLocation)
            around = { latitude: currentLocation.lat, longitude: currentLocation.lon };

        const candidates = await this._tpClient.lookupLocation(searchKey, around);

        // ignore locations larger than a city
        const mapped = candidates.filter((c) => c.rank >= 16).map((c) => {
            return new Ast.Location.Absolute(c.latitude, c.longitude, c.display);
        });

        if (mapped.length === 0) {
            await this._dlg.replyInterp(this._("Sorry, I cannot find any location matching “${location}”."), {
                location: searchKey,
            });
            throw new CancellationError();
        }

        return new Ast.Value.Location(mapped[0]);
    }

    private _tryGetStoredVariable(type : Type, variable : string) : Ast.Value|null {
        const sharedPrefs = this._platform.getSharedPreferences();

        const value = sharedPrefs.get('context-' + variable);
        if (value === undefined)
            return null;
        return Ast.Value.fromJSON(type, value);
    }

    protected async resolveUserContext(variable : string) : Promise<Ast.Value> {
        let value : Ast.Value|null = null;
        switch (variable) {
            case '$context.location.current_location': {
                const location = await this._tryGetCurrentLocation();
                if (location)
                    value = new Ast.Value.Location(location);
                else
                    value = this._tryGetStoredVariable(Type.Location, variable);
                break;
            }
            case '$context.location.home':
            case '$context.location.work':
                value = this._tryGetStoredVariable(Type.Location, variable);
                break;
            case '$context.time.morning':
            case '$context.time.evening':
                value = this._tryGetStoredVariable(Type.Time, variable);
                break;
            default:
                throw new TypeError('Invalid variable ' + variable);
        }
        if (value !== null)
            return value;

        let question, type;
        switch (variable) {
        case '$context.location.current_location':
            question = this._("Where are you now?");
            type = ValueCategory.Location as const;
            break;
        case '$context.location.home':
            question = this._("What is your home address?");
            type = ValueCategory.Location as const;
            break;
        case '$context.location.work':
            question = this._("What is your work address?");
            type = ValueCategory.Location as const;
            break;
        case '$context.time.morning':
            question = this._("What time does your morning begin?");
            type = ValueCategory.Time as const;
            break;
        case '$context.time.evening':
            question = this._("What time does your evening begin?");
            type = ValueCategory.Time as const;
            break;
        }

        let answer = await this._dlg.ask(type, question);
        if (type === ValueCategory.Location) {
            assert(answer instanceof Ast.LocationValue);

            if (answer.value instanceof Ast.RelativeLocation)
                answer = await this.resolveUserContext('$context.location.' + answer.value.relativeTag);
            else if (answer.value instanceof Ast.UnresolvedLocation)
                answer = await this.lookupLocation(answer.value.name, []);
        }

        const sharedPrefs = this._platform.getSharedPreferences();
        sharedPrefs.set('context-' + variable, answer.toJS());
        return answer;
    }

    getPreferredUnit(type : string) : string|undefined {
        const pref = this._platform.getSharedPreferences();
        return pref.get('preferred-' + type) as string|undefined;
    }
}

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
import * as TT from 'thingtalk';
import * as stream from 'stream';

import Engine from '../../index';
import ExecWrapper, { CompiledQueryHints } from '../../apps/exec_wrapper';

import FAQ from './faq.json';

// A placeholder object for builtin triggers/queries/actions that
// don't have any better place to live, such as those related to
// time
export default class MiscellaneousDevice extends Tp.BaseDevice {
    constructor(engine : Engine, state : { kind : string }) {
        super(engine, state);

        this.isTransient = true;
        this.uniqueId = 'thingengine-own-global';
        this.name = engine._("Miscellaneous Interfaces");
        this.description = engine._("Time, randomness and other non-device specific things.");
    }

    get ownerTier() {
        // this pseudo-device does not live anywhere specifically
        return Tp.Tier.GLOBAL;
    }

    async checkAvailable() {
        return Tp.Availability.AVAILABLE;
    }

    get_get_date() {
        return [{ date: new Date }];
    }
    get_get_time() {
        const now = new Date;
        // FIXME convert to the right timezone...
        return [{ time: new Tp.Value.Time(now.getHours(), now.getMinutes(), now.getSeconds()) }];
    }
    get_get_random_between({ low, high } : { low : number|null|undefined, high : number|null|undefined }) {
        if ((low === null || low === undefined) && (high === null || high === undefined)) {
            low = 1;
            high = 6;
        } else if (low === null || low === undefined) {
            low = high! < 0 ? Math.min(2 * high!, high! - 5) : 1;
        } else if (high === null || high === undefined) {
            high = low < 0 ? 0 : Math.max(2 * low, low + 5);
        }
        return [{ random: Math.round(low + (Math.random() * (high! - low))) }];
    }

    get_get_name() {
        const platform = this.platform;
        const prefs = platform.getSharedPreferences();
        const name = prefs.get('user-preferred-name');
        if (!name) {
            const err : Error & { code ?: string } = new Error('preferred name is not set yet');
            err.code = 'unset';
            throw err;
        }
        return [{ name }];
    }

    async get_get_gps() {
        const gps = this.engine.platform.getCapability('gps');
        if (gps === null)
            throw new Error((this.engine as Engine)._("Sorry, I cannot access your location in this version of Almond."));
        const location = await gps.getCurrentLocation();
        if (location) {
            return [{ location: { x: location.longitude, y: location.latitude, display: location.display },
                      altitude: location.altitude,
                      bearing: location.bearing,
                      speed: location.speed }];
        } else {
            return [{ location: { x: 0, y: 0, display: (this.engine as Engine)._("Unknown") },
                      altitude: 0,
                      bearing: 0,
                      speed: 0 }];
        }
    }
    subscribe_get_gps() {
        const gps = this.engine.platform.getCapability('gps');
        if (gps === null)
            throw new Error((this.engine as Engine)._("Sorry, I cannot access your location in this version of Almond."));
        const gpsstream = new stream.Readable({ objectMode: true, read() {} });

        gps.onlocationchanged = (location) => {
            if (location !== null) {
                gpsstream.push({ location: { x: location.longitude, y: location.latitude, display: location.display },
                                 altitude: location.altitude,
                                 bearing: location.bearing,
                                 speed: location.speed });
            }
        };
        gps.start();
        gpsstream.destroy = () => gps.stop();
        return gpsstream;
    }

    async *get_device() {
        // TODO use hints

        for (let page = 0; ; page++) {
            const devices = await this.engine.thingpedia.getDeviceList(undefined, page, 10);
            for (let j = 0; j < Math.min(devices.length, 10); j++) {
                const device = devices[j];
                yield {
                    id: new Tp.Value.Entity(device.primary_kind, device.name),
                    description: device.description,
                    category: device.subcategory
                };
            }
            if (devices.length <= 10)
                break;
        }
    }

    async get_device_info({ id } : { id : unknown }) {
        const manifest = await this.engine.schemas.getFullMeta(String(id));
        return [{
            help: manifest.getNaturalLanguageAnnotation('help'),
            description: manifest.getNaturalLanguageAnnotation('thingpedia_description'),
            thingpedia_url: manifest.getImplementationAnnotation('thingpedia_url') || `https://dev.almond.stanford.edu/thingpedia/devices/by-id/${id}`,
            website:  manifest.getImplementationAnnotation('website'),
            category:  manifest.getImplementationAnnotation('subcategory'),
            issue_tracker:  manifest.getImplementationAnnotation('issue_tracker'),
        }];
    }

    async get_commands(params : unknown, hints ?: CompiledQueryHints) {
        let dataset;
        if (hints && hints.filter) {
            for (const [pname, op, value] of hints.filter) {
                if (pname === 'device' && op === '==') {
                    dataset = this.engine.thingpedia.getExamplesByKinds([String(value)]);
                    break;
                } else if (pname === 'device' && op === 'in_array') {
                    dataset = this.engine.thingpedia.getExamplesByKinds((value as unknown[]).map((v) => String(v)));
                    break;
                }
            }
        }
        if (!dataset)
            dataset = this.engine.thingpedia.getAllExamples();

        const code = await dataset;
        let parsed;
        try {
            parsed = TT.Syntax.parse(code);
        } catch(e) {
            if (e.name !== 'SyntaxError')
                throw e;
            // try parsing using legacy syntax too in case we're talking
            // to an old Thingpedia that has not been migrated
            parsed = TT.Syntax.parse(code, TT.Syntax.SyntaxType.Legacy);
        }
        await parsed.typecheck(this.engine.schemas, false);
        assert(parsed instanceof TT.Ast.Library);

        return parsed.datasets[0].examples.map((ex) => {
            let device;
            // find the device name for the example
            ex.visit(new class extends TT.Ast.NodeVisitor {
                visitDeviceSelector(sel : TT.Ast.DeviceSelector) {
                    device = sel.kind;
                    return false;
                }
            });
            return {
                id: String(ex.id),
                device: device,
                program: new Tp.Value.Entity(ex.prettyprint(), ex.utterances[0])
            };
        });
    }

    do_faq_reply({ question } : { question : string }) {
        let replies = (FAQ as Record<string, (string[]|Record<string,string[]>)>)[question];
        if (!Array.isArray(replies))
            replies = replies[this.platform.type] || replies.default;

        if (process.env.TEST_MODE)
            return { reply: replies[0] };
        else
            return { reply: replies[Math.floor(Math.random()*replies.length)] };
    }

    do_debug_log(args : { message : string }) {
        console.log('DEBUG:', args.message);
    }
    do_say(args : { message : string }) {
        return { message_output: args.message };
    }
    do_open_url({ url } : { url : unknown }) {
        const cap = this.engine.platform.getCapability('app-launcher');
        if (!cap)
            throw new Error((this.engine as Engine)._("Opening files is not implemented in this Almond"));
        return cap.launchURL(String(url));
    }

    async do_configure({ device } : { device : unknown }) : Promise<never> {
        const tpClient = this.engine.thingpedia;
        try {
            await tpClient.getDeviceCode(String(device));
        } catch(e) {
            if (e.code === 404)
                e.code = 'unsupported_skill';
            throw e;
        }

        // TODO restore the ability to configure skills from inside the dialogue
        const err : Error & { code ?: string } = new Error('not supported');
        err.code = 'unsupported_platform';
        throw err;

        /*
        var conversation = env.app.getConversation();
        if (!conversation)
            throw new Error(this.engine._("User not available"));
        // run it asynchronously, or we'll deadlock
        Promise.resolve(conversation.interactiveConfigure(String(args.device))).catch((err) => {
            // the error has already been logged by Almond, and the user has been informed
        });
        */
    }
    do_discover(args : unknown, env : ExecWrapper) : never {
        /*
        var conversation = env.app.getConversation();
        if (!conversation)
            throw new Error(this.engine._("User not available"));
        // run it asynchronously, or we'll deadlock
        Promise.resolve(conversation.interactiveConfigure(null)).catch((err) => {
            // the error has already been logged by Almond, and the user has been informed
        });
        */
        throw new Error('not implemented');
    }

    do_set_language() : never {
        const err : Error & { code ?: string } = new Error('not supported');
        if (this.platform.type === 'cloud')
            err.code = 'unsupported_platform_cloud';
        else
            err.code = 'unsupported_language';
        throw err;
    }

    do_set_timezone() : never {
        const err : Error & { code ?: string } = new Error('not supported');
        // in cloud, the timezone is set in the user DB
        // in server/gnome, the timezone is the system timezone
        // either way, no luck
        if (this.platform.type === 'cloud')
            err.code = 'unsupported_platform_cloud';
        else
            err.code = 'unsupported_platform';
        throw err;
    }

    do_set_wake_word() : never {
        const err : Error & { code ?: string } = new Error('not supported');
        err.code = 'unsupported';
        throw err;
    }

    do_set_voice_output({ status } : { status : 'on'|'off' }) {
        const platform = this.platform;
        if (!platform.hasCapability('sound')) {
            const err : Error & { code ?: string } = new Error('not supported');
            err.code = 'unsupported';
            throw err;
        }
        const prefs = platform.getSharedPreferences();
        // TODO this does not quite work because SpeechHandler doesn't listen
        // to preference changes
        prefs.set('enable-voice-output', status === 'on');
    }

    do_set_voice_input({ status } : { status : 'on'|'off' }) {
        const platform = this.platform;
        if (!platform.hasCapability('sound')) {
            const err : Error & { code ?: string } = new Error('not supported');
            err.code = 'unsupported';
            throw err;
        }
        const prefs = platform.getSharedPreferences();
        // TODO this does not quite work because SpeechHandler doesn't listen
        // to preference changes
        prefs.set('enable-voice-input', status === 'on');
    }

    do_set_name({ name } : { name : string }) {
        const platform = this.platform;
        const prefs = platform.getSharedPreferences();
        prefs.set('user-preferred-name', name);
    }

    do_set_location({ type, location } : { type : 'current'|'home'|'work', location : Tp.Value.Location }) {
        const platform = this.platform;
        const prefs = platform.getSharedPreferences();
        prefs.set('context-$context.location.' + (type === 'current' ? 'current_location' : type),
            new TT.Ast.LocationValue(new TT.Ast.AbsoluteLocation(location.lat, location.lon, location.display)).toJS());
    }

    do_set_temperature_unit({ unit } : { unit : string }) {
        const platform = this.platform;
        const prefs = platform.getSharedPreferences();
        prefs.set('preferred-temperature', unit[0].toUpperCase());
    }
}

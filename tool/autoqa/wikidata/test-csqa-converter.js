// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Naoki Yamamura <yamamura@cs.stanford.edu>
"use strict";
import assert from 'assert';

import {
    CsqaConverter,
} from './csqa-converter';

const INSTANCES = new Set(['Q16', 'Q27', 'Q30', 'Q38', 'Q142', 'Q145', 'Q159', 'Q183', ' Q230', 'Q403', 'Q414', 'Q869', 'Q916']);
const PROPERTY_LABELS = {
    P17: 'country',
    P27: 'country of citizenship',
    P35: 'head of state',
    P47: 'shares border with',
    P194: 'legislative body',
    P291: 'place of publication',
    P463: 'member of',
    P530: 'diplomatic relation',
    P921: 'main subject',
};
const ENTITY_LABELS = {
    Q16: 'Canada',
    Q27: 'Ireland',
    Q30: 'United States of America ',
    Q38: 'Italy',
    Q142: 'France',
    Q145: 'United Kingdom',
    Q159: 'Russia',
    Q183: 'Germany',
    Q230: 'Georgia',
    Q403: 'Serbia',
    Q414: 'Argentina',
    Q869: 'Thailand',
    Q916: 'Angola',
    Q1428: 'Georgia', // State of Georgia not country (Q230).
    Q56004: 'Corvey',
    Q111466: 'Pontoglio',
    Q191067: 'article',
    Q360469: 'Charles III, Duke of Parma',
    Q484652: 'international organization',
    Q502895: 'common name',
    Q838948: 'work of art',
    Q1048835: 'political territorial entity',
    Q11103562: 'Higashine interchange',
    Q12318599: 'Isabelle Brockenhuus-Løwenhielm',
    Q15617994: 'designation for an administrative territorial entity',
};

const TEST_CASES = [
    // Test 1: 1. Simple Question (subject-based)
    [{  user: {
        ques_type_id: 1,
        utterance: 'Who is the head of state of Angola ?',
        sec_ques_type: 1 },
        system: { 
        utterance: 'José Eduardo dos Santos',
        active_set: [ '(Q916,P35,c(Q502895))' ],
    }},
    '[head_of_state] of @org.wikidata.country() filter id =~ "angola"'],
    // Test 2: 2.1. Secondary question, Subject based question
    [{  user: {
            ques_type_id: 2,  
            sec_ques_sub_type: 1,  
            sec_ques_type: 1,
            utterance: 'Which assembly governs France ?' },
        system: {
            utterance: 'French Parliament',
            active_set: [ '(Q142,P194,c(Q1752346))' ],
    }},
    '[legislative_body] of @org.wikidata.country() filter id =~ "france"'],
    // Test 3: 2.2. Secondary question, Object based question
    [{  user: {
            ques_type_id: 2,
            sec_ques_sub_type: 1,
            sec_ques_type: 2,
            utterance: 'Which work of art has Germany as its publication location ?' },
        system: {
            utterance: 'One Who Set Forth: Wim Wenders\' Early Years',
            active_set: [ '(c(Q838948),P291,Q183)' ],
    }},
    '[place_of_publication] of @org.wikidata.country() filter id =~ "germany"'],
    // Test 4: 4.1. Set-based question OR
    [{  user: {
            set_op_choice: 1,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which administrative territories share border with Thailand or Pontoglio ?' },
        system: {
          utterance: 'Malaysia, Myanmar, Cambodia, Palazzolo sull\'Oglio, Chiari, Urago d\'Oglio, Laos, Cividate al Piano, Palosco',
          active_set: [ 'OR((Q869,P47,c(Q15617994)), (Q111466,P47,c(Q15617994)))' ],
    }},
    '[shares_border_with] of @org.wikidata.country() filter id =~ "thailand" || shares_border_with =~ "pontoglio"'],
    // Test 5: 4.1. Set-based question OR
    [{  user: {
            set_op_choice: 1,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which political territories have a diplomatic relationship with United States of America or are the native countriesof Isabelle Brockenhuus-Løwenhielm ?' },
        system: {
            utterance: 'Australia, Canada, Germany, Denmark',
            active_set: [ 'OR((Q30,P530,c(Q1048835)), (Q12318599,P27,c(Q1048835)))' ]}},
    '[diplomatic_relation, country_of_citizenship] of @org.wikidata.country() filter id =~ "united states of america " || country_of_citizenship =~ "isabelle brockenhuus-løwenhielm"'],
    // Test 6: 4.2. Set-based question AND
    [{  user: {
            set_op_choice: 2,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which administrative territories share border with France and are Charles III, Duke of Parma a civilian of ?' },
        system: {
            utterance: 'Kingdom of the Netherlands',
            active_set: [ 'AND((Q142,P47,c(Q15617994)), (Q360469,P27,c(Q15617994)))' ],
    }},
    '[shares_border_with, country_of_citizenship] of @org.wikidata.country() filter id =~ "france" && country_of_citizenship =~ "charles iii, duke of parma"'],
    // Test 7: 4.2. Set-based question AND
    [{  user: {
            set_op_choice: 2,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which people are a native of Italy and United Kingdom ?' },
        system: { 
            utterance: 'Some of them are Virginia Peirano, Jane Alexander, Rafael Sabatini, Fiona May, Enrico Bayon, Simonetta Agnello Hornby, Liz Scalia, Rosemary Dexter, Arthur Valerian Wellesley, 8th Duke of Wellington, Diego De Girolamo',
            active_set: [ 'AND((c(Q502895),P27,Q38), (c(Q502895),P27,Q145))' ],
    }},
    '[country_of_citizenship] of @org.wikidata.country() filter id =~ "united kingdom" && id =~ "italy"'],
    // Test 8: 4.3. Set-based question Difference
    [{  user: {
            set_op_choice: 3,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which administrative territories have diplomatic relationships with Ireland but not Canada ?' },
        system: { 
            utterance: 'France, Zambia',
            active_set: [ 'AND((Q27,P530,c(Q15617994)), NOT((Q16,P530,c(Q15617994))))' ],
    }},
    '[diplomatic_relation] of @org.wikidata.country() filter id =~ "ireland" && !(id =~ "canada")'],
    // Test 9: 4.3. Set-based question Difference
    [{  user: {
            set_op_choice: 3,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which administrative territories have diplomatic relationships with Russia and are not Higashine interchange present in ?' },
        system: { 
            utterance: 'Some of them are Venezuela, Italy, Zambia, Turkey, Argentina, Vietnam, Mongolia, United States of America, Brazil, India',
            active_set: [ 'AND((Q159,P530,c(Q15617994)), NOT((Q11103562,P17,c(Q15617994))))' ],
    }},
    '[diplomatic_relation, country] of @org.wikidata.country() filter id =~ "russia" && !(country =~ "higashine interchange")'],
    // Test 10: 7.1. Comparative and Quantitative questions (involving single entity), Quantitative (count) single entity
    [{  user: {
            ques_type_id: 7,
            count_ques_sub_type: 1,
            count_ques_type: 1,
            utterance: 'How many administrative territories have diplomatic relationships with Argentina ?',
            is_incomplete: 0 },
        system: { 
            utterance: '4',
            active_set: [ '(Q414,P530,c(Q15617994))' ],
    }},
    'count([diplomatic_relation] of @org.wikidata.country() filter id =~ "argentina")'],
    // Test 11: 8.1. Comparative and Quantitative questions (involving multiple(2) entities), Quantitative with Logical Operators
    // Note: second filter should be from another table ("Georgia state not country")
    [{  user: {
            set_op: 1,
            ques_type_id: 8,
            count_ques_sub_type: 1,
            count_ques_type: 1,
            utterance: 'How many international organizations were Serbia and Georgia a member of ?',
            is_incomplete: 0 },
       system: { 
            utterance: '2',
            active_set: [ '(Q403,P463,c(Q484652))', '(Q1428,P463,c(Q484652))' ]
    }},
    'count([member_of] of @org.wikidata.country() filter id =~ "serbia" && member_of =~ "georgia")'],
    // Test 12: 8.1. Comparative and Quantitative questions (involving multiple(2) entities), Quantitative with Logical Operators
    [{  user: {
            set_op: 2,
            ques_type_id: 8,
            count_ques_sub_type: 1,
            count_ques_type: 2,
            utterance: 'How many articles were mainly based on Canada or Corvey ?',
            is_incomplete: 0 },
        system: {
            utterance: '2',
            active_set: [ '(c(Q191067),P921,Q16)', '(c(Q191067),P921,Q56004)' ],
    }},
    'count([main_subject] of @org.wikidata.country() filter id =~ "canada" || main_subject =~ "corvey")'],
    // Test 13: 8.2. Comparative and Quantitative questions (involving multiple(2) entities), Quantitative (count) multiple entity
    [{  user: {
            set_op: 2,
            ques_type_id: 8,
            count_ques_sub_type: 2,
            count_ques_type: 1,
            utterance: 'How many administrative territories or political territories have a diplomatic relationship with France ?',
            is_incomplete: 0 },
        system: {
            utterance: '18',
            active_set: [ '(Q142,P530,c(Q15617994))', '(Q142,P530,c(Q1048835))' ],
    }},
    'count([diplomatic_relation] of @org.wikidata.country() filter id =~ "france")'],
];

async function test(index) {
    const csqaConverter = new CsqaConverter({
        domains: 'Q6256',
        canonicals: 'country',
        instances: INSTANCES,
        propertyLabels: PROPERTY_LABELS,
        entityLabels: ENTITY_LABELS
    });
    let dialog = TEST_CASES[index][0];
    let expected = TEST_CASES[index][1];
    const generated = await csqaConverter.csqaToThingTalk('country', dialog);
    assert.strictEqual(generated, expected);
}

export default async function main() {    
    for (let i = 0; i < TEST_CASES.length; i++) {
        console.log("TEST CASE #" + (i + 1));
        await test(i);
    }
}
if (!module.parent) main();
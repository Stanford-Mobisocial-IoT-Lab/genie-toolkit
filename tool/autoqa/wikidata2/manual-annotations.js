// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Silei Xu <silei@cs.stanford.edu>
"use strict";
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const PROPERTY_TYPE_OVERRIDE = {
    'P166': Type.Array(Type.Entity('org.wikidata:award')), // award_received
    'P1411': Type.Array(Type.Entity('org.wikidata:award')), // nominated_for
    'P106': Type.Array(Type.Entity('org.wikidata:occupation')), // occupation
    'P26': Type.Array(Type.Entity('org.wikidata:human')), // spouse (it misses no "value type constraint" property)
    'P21': Type.Enum(['female', 'male']),
    'P17': Type.Entity('org.wikidata:country'), // country
    'P2295': Type.Currency, // net profit (it misses no allowed unit property)
    'P2031': Type.Date, // work_period_start
    'P2032': Type.Date, // work_period_end
    'P172': Type.Array(Type.Entity('org.wikidata:ethnic_group')), // ethnic_group
    'P1344': Type.Array(Type.Entity('org.wikidata:event')), //participant_in
    'P54': Type.Array(Type.Entity('org.wikidata:sports_team')), // member_of_sports_team
    'P647': Type.Entity('org.wikidata:sports_team'), // drafted by
    'P1618': Type.Array(Type.Number), // sport_number
    'P1352': Type.Number, // ranking
    'P1303': Type.Array(Type.Entity('org.wikidata:musical_instrument')), // instrument
    'P264': Type.Array(Type.Entity('org.wikidata:record_label')), // record_label
    'P361': Type.Array(Type.String), // part_of
    'P398': Type.Array(Type.Entity('org.wikidata:star')), // child_astronomical_body
    'P397': Type.Array(Type.Entity('org.wikidata:star')), // parent_astronomical_body
    'P2227': Type.Number, // metallicity
    'P85': Type.Entity('org.wikidata:song'), // anthem
    'P942': Type.Entity('org.wikidata:song'), // theme_music
    'P36': Type.Entity('org.wikidata:city'), // capital
    'P206': Type.Array(Type.String), // located_in_or_next_to_body_of_water
    'P610': Type.Location, // highest point
    'P1589': Type.Location, // lowest point

    'P376': Type.Location, // 
    'P531': Type.Location, // 
    'P562': Type.Entity('org.wikidata:organization'), // 
    'P609': Type.Location, // 
    'P631': Type.Entity('org.wikidata:occupation'), // 
    'P793': Type.Entity('org.wikidata:event'), // 
    'P797': Type.Entity('org.wikidata:human'), // 
    'P913': Type.Entity('org.wikidata:notation'), // 
    'P831': Type.Entity('org.wikidata:organization'), // 
    'P943': Type.Entity('org.wikidata:occupation'), // 

};

// properties that should have the same type as the subject
const PROPERTY_TYPE_SAME_AS_SUBJECT = new Set([
    'P190', // twinned_administrative_body
    'P47', // shares_border_with
    'P530', // diplomatic_relation
]);

const PROPERTY_FORCE_ARRAY = new Set([
    'P1449', // nickname
    'P1813', // short name
    'P206', // located_in_or_next_to_body_of_water
    'P190', // twinned_administrative_body
    'P47', // shares_border_with
    'P112', // founded_by
    'P488', // chair person
    'P2828', // corporate_officer
    'P452', // industry,
    'P1056', // product_or_material_produced
    'P39', // position_held
    'P3373', // sibling
    'P40', // children
    'P1412', // languages_spoken_written_or_signed
    'P1830', // owner_of
    'P127', // owned_by
    'P859', // sponsor
    'P551', // residence
    'P1344', // participant_in,
    'P641', // sport
    'P413', // position_played_on_team_or_speciality,
    'P118', // league
    'P412', // voice type
    'P800', // notable_work (this will be just array of string, wikidata doesn't have 'creative work'
    'P37', // official language
    'P6', // head of government
    'P150', // contains_administrative_territorial_entity,
    'P421', // time zone
    'P170', // creator
    'P58', // screenwriter
    'P161', // cast member
    'P162', // producer
    'P674', // characters
]);

const PROPERTY_FORCE_NOT_ARRAY = new Set([

]);


const MANUAL_PROPERTY_CANONICAL_OVERRIDE = {

};

const MANUAL_TABLE_CANONICAL_OVERRIDE = {

};

const PROPERTIES_NO_FILTER = [

];

const STRING_FILE_OVERRIDES = {
};


module.exports = {
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE,

    PROPERTY_TYPE_OVERRIDE,
    PROPERTIES_NO_FILTER,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_TYPE_SAME_AS_SUBJECT,

    STRING_FILE_OVERRIDES
};

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

import { Type } from 'thingtalk';

const PROPERTY_TYPE_OVERRIDE = {
    'P166': new Type.Array(new Type.Entity('org.wikidata:award')), // award_received
    'P1411': new Type.Array(new Type.Entity('org.wikidata:award')), // nominated_for
    'P106': new Type.Array(new Type.Entity('org.wikidata:occupation')), // occupation
    'P26': new Type.Array(new Type.Entity('org.wikidata:human')), // spouse (it misses no "value type constraint" property)
    'P21': new Type.Enum(['female', 'male']),
    'P17': new Type.Entity('org.wikidata:country'), // country
    'P2295': Type.Currency, // net profit (it misses no allowed unit property)
    'P2031': Type.Date, // work_period_start
    'P2032': Type.Date, // work_period_end
    'P172': new Type.Array(new Type.Entity('org.wikidata:ethnic_group')), // ethnic_group
    'P1344': new Type.Array(new Type.Entity('org.wikidata:event')), //participant_in
    'P54': new Type.Array(new Type.Entity('org.wikidata:sports_team')), // member_of_sports_team
    'P647': new Type.Entity('org.wikidata:sports_team'), // drafted by
    'P1618': new Type.Array(Type.Number), // sport_number
    'P1352': Type.Number, // ranking
    'P1303': new Type.Array(new Type.Entity('org.wikidata:musical_instrument')), // instrument
    'P264': new Type.Array(new Type.Entity('org.wikidata:record_label')), // record_label
    'P398': new Type.Array(new Type.Entity('org.wikidata:star')), // child_astronomical_body
    'P397': new Type.Array(new Type.Entity('org.wikidata:star')), // parent_astronomical_body
    'P2227': Type.Number, // metallicity
    'P85': new Type.Entity('org.wikidata:song'), // anthem
    'P942': new Type.Entity('org.wikidata:song'), // theme_music
    // From country domain
    'P36': new Type.Entity('org.wikidata:city'), // capital
    'P190': new Type.Array(new Type.Entity('org.wikidata:city')), // sister city
    'P206': new Type.Array(new Type.Entity('org.wikidata:body_of_water')), // located_in_or_next_to_body_of_water
    'P610': Type.Location, // highest point
    'P1589': Type.Location, // lowest point
    'P38': Type.Currency,
    'P1313': new Type.Entity('org.wikidata:position'), // office held by head of government
    'P237': new Type.Array(new Type.Entity('org.wikidata:coat_of_arms')), // coat of arms
    'P421': new Type.Entity('org.wikidata:time_zone'),// located in time zone
    'P163': new Type.Entity('org.wikidata:flag'),// flag
    'P194': new Type.Entity('org.wikidata:organization'),// legislative body
    'P793': new Type.Array(new Type.Entity('org.wikidata:event')), // significant event    
    'P1456': new Type.Array(new Type.Entity('org.wikidata:monuments')), // list of monuments
    'P376': Type.Location, //located on astronomical body
    'P1435': new Type.Entity('org.wikidata:monuments'), // heritage status
    'P355': new Type.Entity('org.wikidata:organization'), // subsidiary
    'P1376': new Type.Entity('org.wikidata:country'), // capital of
    'P1448': Type.String, // official name
    'P3238': new Type.Entity('org.wikidata:phone_number'), // trunk prefix
    'P1451': Type.String, // motto text
    'P443': new Type.Entity('org.wikidata:audio'), // pronunciation audio
    'P1814': Type.String, // name in kana
    'P487': Type.String, // Unicode character
    'P395': Type.String, // licence plate code
    'P1705': new Type.Entity('tt:iso_lang_code'), // native label
    'P1813': new Type.Entity('org.wikidata:acronym'), // short name
    'P3075': new Type.Entity('org.wikidata:religion'), // official religion
    'P51': new Type.Entity('org.wikidata:audio'), // audio
    'P2013': new Type.Entity('org.wikidata:id'), // Facebook ID
    'P1325': new Type.Entity('tt:url'), // external data available at
    'P10': new Type.Entity('org.wikidata:video'), // video
    'P281': new Type.Entity('org.wikidata:postal_code'), // postal code
    'P15': new Type.Entity('org.wikidata:map'), // route map
    'P1329': new Type.Entity('org.wikidata:phone_number'), // phone number
    'P3084': new Type.Entity('org.wikidata:legal_concept'), // freedom of panorama
    'P1449': new Type.Entity('org.wikidata:name'), // nickname
    'P101': new Type.Entity('org.wikidata:field_of_work'), // field of work
    'P144': Type.String, // based on
    'P921': new Type.Entity('org.wikidata:topic'), // main subject
    'P710': new Type.Entity('org.wikidata:participant'), // participant
    'P272': new Type.Entity('org.wikidata:production_company'), // production company
    'P449': new Type.Entity('org.wikidata:production_company'), // original network
    'P841': Type.Date, // feast day
    'P180': new Type.Entity('org.wikidata:topic'), // depicts
    'P2695': new Type.Entity('org.wikidata:type_locality'), // type locality
    'P1408': new Type.Entity('org.wikidata:city'), // licensed to broadcast to
    'P750':  new Type.Entity('org.wikidata:distributor'), // distributor
    'P1027': new Type.Entity('org.wikidata:award'), // conferred by
    'P532': Type.Location, // port of registry, found 11 values
    'P749': new Type.Entity('org.wikidata:organization'), // parent organization
    'P121': new Type.Entity('org.wikidata:item_operated'), // item operated
    'P437': new Type.Entity('org.wikidata:media_type'), // distribution
    'P737': new Type.Entity('org.wikidata:human'), // influenced by
    'P69': new Type.Entity('org.wikidata:organization'), // educated at
    'P1433': new Type.Entity('org.wikidata:publication'), // published in
    'P136': new Type.Entity('org.wikidata:topic'), // genre
    'P467': new Type.Entity('org.wikidata:organization'), // legislated by, found 1 values
    'P39': new Type.Entity('org.wikidata:position'), // position held, found 2 values
    'P504': Type.Location, // home port
    'P609': Type.Location, // terminus location
    'P1416': new Type.Entity('org.wikidata:organization'), // affiliation, found 1 values
    'P608': new Type.Entity('org.wikidata:event'), // exhibition history, found 1 values
    'P805': new Type.Entity('org.wikidata:topic'), // subject of
    'P3179': Type.Location, // territory overlaps
    // From city domain
    'P1383': Type.Location, // contains settlement
    'P2439': new Type.Entity('tt:iso_lang_code'), // language
    'P366': Type.String, // use
    'P149': new Type.Entity('org.wikidata:architectural_style'), // architectural style
    'P1001': new Type.Entity('org.wikidata:organization'), // applies to jurisdiction
    'P837': Type.Date, // day in year for periodic occurrence
    'P937': Type.Location, // work location
    'P2348': Type.Date, // period
    'P27': new Type.Entity('org.wikidata:country'), // country of citizenship
    'P1382': Type.String, // coincident with, found 4 values
    'P186': new Type.Entity('org.wikidata:material'), // material used
    'P1056': new Type.Entity('org.wikidata:material'), // product
    'P1576': Type.String, // lifestyle
    'P530': new Type.Entity('org.wikidata:country'), // diplomatic relation
    'P495': new Type.Entity('org.wikidata:country'), // country of origin
    'P708': new Type.Entity('org.wikidata:religion'), // diocese
    'P611': new Type.Entity('org.wikidata:religion'), // religious order
    'P931': Type.Location, // place served by airport
    'P195': new Type.Entity('org.wikidata:collection'), // collection
    'P559': Type.Location, // terminus, found 61 values
    'P53': new Type.Entity('org.wikidata:family'), // noble family
    'P113': Type.Location, // airline hub
    'P81': new Type.Entity('org.wikidata:railway_line'), // connecting line
    'P197': Type.Location, // adjacent station
    'P403': new Type.Entity('org.wikidata:mouth_of_the_watercourse'), // mouth of the watercourse
    'P734': new Type.Entity('org.wikidata:name'), // family name
    'P2632': Type.Location, // place of detention
    'P1686': new Type.Entity('org.wikidata:work'), // for work
    'P768': new Type.Entity('org.wikidata:district'), // electoral district
    'P413': new Type.Entity('org.wikidata:position'), // position played on team / speciality
    'P2554': new Type.Entity('org.wikidata:designer'), // production designer
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
    //'P150', // contains_administrative_territorial_entity,
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


export {
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE,

    PROPERTY_TYPE_OVERRIDE,
    PROPERTIES_NO_FILTER,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_TYPE_SAME_AS_SUBJECT,

    STRING_FILE_OVERRIDES
};

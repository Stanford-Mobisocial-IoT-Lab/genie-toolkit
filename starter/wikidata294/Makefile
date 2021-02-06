geniedir = ../..
memsize := 16000
genie = node --require ts-node/register --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/tool/genie.ts

# aws setup (temporary)
owner ?= silei
project = wikidata2


# set up domain

all_experiments = city country
experiment ?= country

city_class = Q515
city_canonical = city

country_class = Q6256
country_canonical = country

class = $($(experiment)_class)
canonical = $($(experiment)_canonical)


# options for manfiest generation
annotation ?= baseline
paraphraser_options ?= --paraphraser-model ./models/paraphraser-bart-large-speedup-megabatch-5m

baseline_process_schemaorg_flags =
wikidata_process_schemaorg_flags =
autoqa_process_schemaorg_flags =

baseline_annotate_flags =
wikidata_annotate_flags =
autoqa_annotate_flags = --algorithms bart-paraphrase $(paraphraser_options)

process_schemaorg_flags ?= $($(annotation)_process_schemaorg_flags)
annotate_flags ?= $($(annotation)_annotate_flags)


# options for synthetic data generation
template_file ?= thingtalk/en/thingtalk.genie
dataset_file ?= emptydataset.tt
synthetic_flags ?= \
	projection_with_filter \
	projection \
	aggregation \
	schema_org \
	filter_join \
	no_stream
generate_flags = $(foreach v,$(synthetic_flags),--set-flag $(v))
custom_generate_flags ?=
pruning_size ?= 200
maxdepth ?= 8


# hyper params for training
model ?= 1
train_iterations ?= 20000
train_save_every ?= 2000
train_log_every ?= 100
train_batch_tokens ?= 4000
val_batch_size ?= 128
train_nlu_flags ?= \
	--train_iterations=$(train_iterations) \
	--dimension=768 \
	--transformer_hidden=768 \
	--transformer_layers=0 \
	--rnn_layers=2 \
	--seq2seq_encoder=Identity \
	--rnn_zero_state=average \
	--context_embeddings=bert-base-uncased@0 \
	--question_embeddings=bert-base-uncased@1 \
	--trainable_encoder_embeddings=0 \
	--trainable_decoder_embeddings=25 \
	--train_context_embeddings \
	--train_context_embeddings_after=80000 \
	--decoder_embeddings= \
	--transformer_lr_multiply=0.5 \
	--train_batch_tokens=$(train_batch_tokens) \
	--val_batch_size=$(val_batch_size)
custom_train_nlu_flags ?=
eval_set ?= eval


.PHONY: clean syncup syncdown datadir
.SECONDARY:


emptydataset.tt:
	echo 'dataset @empty {}' > $@

%/wikidata.tt: %/parameter-datasets.tsv $(geniedir)/tool/autoqa/wikidata/process-schema.js
	mkdir -p $(dir $@)
	$(genie) wikidata-process-schema  -o $@.tmp --entities $(experiment)/entities.json \
		--domains $(class) \
		--domain-canonicals $(canonical) \
		--parameter-datasets $*/parameter-datasets.tsv \
		--properties $(file < $(dir $@)properties.txt) \
		$(process_schemaorg_flags)
	mv $@.tmp $@

$(experiment)/parameter-datasets.tsv: $(geniedir)/tool/autoqa/wikidata/preprocess-data.js
	mkdir -p $(dir $@)
	$(genie) wikidata-preprocess-data \
		--domains $(class) \
		--domain-canonicals $(canonical) \
		--input /mnt/data/shared/wikidata/value \
		--output ./ \
		$(process_schemaorg_flags)

%/constants.tsv: %/parameter-datasets.tsv %/wikidata.tt
	$(genie) sample-constants -o $@.tmp --parameter-datasets $*/parameter-datasets.tsv --thingpedia $*/wikidata.tt --devices org.wikidata
	cat $(geniedir)/data/en-US/constants.tsv >> $@.tmp
	mv $@.tmp $@

%/manifest.tt: %/constants.tsv %/wikidata.tt %/parameter-datasets.tsv models/paraphraser-bart-large-speedup-megabatch-5m
	$(genie) auto-annotate -o $@.tmp \
	--constants $*/constants.tsv \
	--thingpedia $*/wikidata.tt \
	--functions $(canonical) \
	--parameter-datasets $*/parameter-datasets.tsv \
	--dataset wikidata \
	$(annotate_flags) \
	--debug
	mv $@.tmp $@

$(experiment)/synthetic-d%.tsv: $(experiment)/manifest.tt $(dataset_file) $(geniedir)/languages/thingtalk/en/*.genie
	$(genie) generate \
	  --template $(geniedir)/languages/$(template_file) \
	  --thingpedia $(experiment)/manifest.tt --entities $(experiment)/entities.json --dataset $(dataset_file) \
	  --target-pruning-size $(pruning_size) \
	  -o $@.tmp $(generate_flags) --maxdepth $$(echo $* | cut -f1 -d'-') --random-seed $@
	mv $@.tmp $@

$(experiment)/synthetic.tsv : $(foreach v,1 2 3,$(experiment)/synthetic-d6-$(v).tsv) $(experiment)/synthetic-d$(maxdepth).tsv
	cat $^ > $@

$(experiment)/augmented.tsv : $(experiment)/synthetic.tsv $(experiment)/parameter-datasets.tsv
	$(genie) augment -o $@.tmp -l en-US --thingpedia $(experiment)/manifest.tt --parameter-datasets $(experiment)/parameter-datasets.tsv \
	  --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 60 --no-quote-paraphrasing-expand-factor 20 --quoted-fraction 0.0 \
	  --debug --no-requotable $(experiment)/synthetic.tsv
	mv $@.tmp $@

datadir: $(experiment)/augmented.tsv
	mkdir -p $@
	if [ "$(eval_set)" = "eval_synthetic" ] ; then \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy sentence \
	    --eval-on-synthetic $(experiment)/augmented.tsv ; \
	  mkdir -p $(experiment)/eval-synthetic ; \
	  cp $@/eval.tsv $(experiment)/eval-synthetic/annotated.tsv; \
	else \
	  cp $(experiment)/augmented.tsv $@/train.tsv ; \
	  cut -f1-3 $(experiment)/${eval_set}/annotated.tsv > $@/eval.tsv ; \
	fi
	touch $@

train:
	mkdir -p $(experiment)/models/$(model)
	-rm datadir/almond
	ln -sf . datadir/almond
	genienlp train \
	  --no_commit \
	  --data datadir \
	  --embeddings .embeddings \
	  --save $(experiment)/models/$(model) \
	  --tensorboard_dir $(experiment)/models/$(model) \
	  --cache datadir/.cache \
	  --train_tasks almond \
	  --preserve_case \
	  --save_every $(train_save_every) \
	  --log_every $(train_log_every) \
	  --val_every $(train_save_every) \
	  --exist_ok \
	  --skip_cache \
	  $(train_nlu_flags) \
	  $(custom_train_nlu_flags)

clean:
	for domain in $(all_experiments) ; do \
		rm -rf $$domain/constants.tsv  $$domain/manifest.tt $$domain/wikidata.tt ;\
	done

$(experiment)/models/%/best.pth:
	mkdir -p $(experiment)/models/
	aws s3 sync --exclude '*/dataset/*' --exclude '*/cache/*' --exclude 'iteration_*.pth' --exclude '*_optim.pth' s3://geniehai/$(owner)/models/${project}/$(experiment)/$*/ $(experiment)/models/$*/

$(experiment)/$(eval_set)/%.results: $(experiment)/models/%/best.pth $(experiment)/$(eval_set)/annotated.tsv $(experiment)/manifest.tt
	$(genie) evaluate-server --url "file://$(abspath $(dir $<))" --thingpedia $(experiment)/manifest.tt $(experiment)/$(eval_set)/annotated.tsv --debug --csv-prefix $(eval_set) --csv $(evalflags) --min-complexity 1 --max-complexity 3 -o $@.tmp | tee $(experiment)/$(eval_set)/$*.debug
	mv $@.tmp $@

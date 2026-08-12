-- 0001 gave baseline's source_dataset_id no on delete cascade, unlike
-- dataset_column and pitch, so re-ingesting a reference dataset after
-- baselines exist died on the foreign key.
alter table baseline
    drop constraint baseline_source_dataset_id_fkey;
alter table baseline
    add constraint baseline_source_dataset_id_fkey
        foreign key (source_dataset_id) references dataset (id) on delete cascade;

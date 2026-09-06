export function beginDataSync(backend, userId) {
  const core = Promise.all([
    backend.listAccounts(userId),
    backend.listAssets(userId),
  ]).then(([accounts, assets]) => ({ accounts, assets }));

  // Convert the optional snapshot request to a settled value immediately so a
  // rejection cannot become unhandled while the required account/asset reads
  // are still in flight. Consumers intentionally do not await this for the
  // initial portfolio render.
  const snapshots = Promise.resolve()
    .then(() => backend.listSnapshots(userId))
    .then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason }),
    );

  return { core, snapshots };
}

export function canExportCompleteBackup({ dataLoaded, dataError, snapshotStatus, syncing }) {
  return Boolean(dataLoaded && !dataError && !syncing && snapshotStatus === 'ready');
}

export function canExportCurrentData({ dataLoaded, dataError, syncing }) {
  return Boolean(dataLoaded && !dataError && !syncing);
}

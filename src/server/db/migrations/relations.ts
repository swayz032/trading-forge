import { relations } from "drizzle-orm/relations";
import { paperSessions, paperTrades, brokerAccounts, accountStrategyAssignments, strategies, paperPositions, strategyDslFeatures, tradingviewMarkers, strategyLockouts, complianceReviews, complianceRulesets, backtests, backtestProvenance, strategyPendingBuckets, strategyPendingMentions, langchainPgCollection, langchainPgEmbedding, quboTimingRuns, strategyFirmEligibility, skipDecisions, strategyGraveyard, pilotSessions, biasState, quantumMcRuns, quantumMcBenchmarks, monteCarloRuns, promptVersions, promptAbTests, strategyNames, systemParameters, systemParameterHistory, backtestMatrix, systemJournal, rlTrainingRuns, mutationOutcomes, paperSessionFeedback, shadowSignals, paperSignalLogs, complianceDriftLog, backtestTrades, cloudQmcRuns, criticOptimizationRuns, criticCandidates, frankensteinTestRuns, quantumRunCosts, shadowRerunFindings, sqaOptimizationRuns, stressTestRuns, syntheticBlackSwanRuns, syntheticRegimeBank, tensorPredictions, tournamentResults, walkForwardWindows, strategyExports, lifecycleTransitions, adversarialStressRuns, strategySignalVectors, strategyExportArtifacts, biasDecisions, productionTrades } from "./schema";

export const paperTradesRelations = relations(paperTrades, ({one}) => ({
	paperSession: one(paperSessions, {
		fields: [paperTrades.sessionId],
		references: [paperSessions.id]
	}),
}));

export const paperSessionsRelations = relations(paperSessions, ({one, many}) => ({
	paperTrades: many(paperTrades),
	paperPositions: many(paperPositions),
	strategy: one(strategies, {
		fields: [paperSessions.strategyId],
		references: [strategies.id]
	}),
	pilotSessions: many(pilotSessions),
	paperSessionFeedbacks: many(paperSessionFeedback),
	shadowSignals: many(shadowSignals),
	paperSignalLogs: many(paperSignalLogs),
}));

export const accountStrategyAssignmentsRelations = relations(accountStrategyAssignments, ({one}) => ({
	brokerAccount: one(brokerAccounts, {
		fields: [accountStrategyAssignments.accountId],
		references: [brokerAccounts.accountId]
	}),
	strategy: one(strategies, {
		fields: [accountStrategyAssignments.strategyId],
		references: [strategies.id]
	}),
}));

export const brokerAccountsRelations = relations(brokerAccounts, ({many}) => ({
	accountStrategyAssignments: many(accountStrategyAssignments),
	tradingviewMarkers: many(tradingviewMarkers),
}));

export const strategiesRelations = relations(strategies, ({many}) => ({
	accountStrategyAssignments: many(accountStrategyAssignments),
	strategyDslFeatures: many(strategyDslFeatures),
	tradingviewMarkers: many(tradingviewMarkers),
	paperSessions: many(paperSessions),
	strategyLockouts: many(strategyLockouts),
	complianceReviews: many(complianceReviews),
	strategyPendingBuckets: many(strategyPendingBuckets),
	quboTimingRuns: many(quboTimingRuns),
	backtests: many(backtests),
	strategyFirmEligibilities: many(strategyFirmEligibility),
	skipDecisions: many(skipDecisions),
	strategyGraveyards: many(strategyGraveyard),
	pilotSessions: many(pilotSessions),
	biasStates: many(biasState),
	strategyNames: many(strategyNames),
	backtestMatrices: many(backtestMatrix),
	systemJournals: many(systemJournal),
	rlTrainingRuns: many(rlTrainingRuns),
	mutationOutcomes: many(mutationOutcomes),
	paperSessionFeedbacks: many(paperSessionFeedback),
	cloudQmcRuns: many(cloudQmcRuns),
	criticOptimizationRuns: many(criticOptimizationRuns),
	frankensteinTestRuns: many(frankensteinTestRuns),
	quantumRunCosts: many(quantumRunCosts),
	shadowRerunFindings: many(shadowRerunFindings),
	sqaOptimizationRuns: many(sqaOptimizationRuns),
	syntheticBlackSwanRuns: many(syntheticBlackSwanRuns),
	tensorPredictions: many(tensorPredictions),
	strategyExports: many(strategyExports),
	criticCandidates: many(criticCandidates),
	lifecycleTransitions: many(lifecycleTransitions),
	adversarialStressRuns: many(adversarialStressRuns),
	strategySignalVectors: many(strategySignalVectors),
}));

export const paperPositionsRelations = relations(paperPositions, ({one}) => ({
	paperSession: one(paperSessions, {
		fields: [paperPositions.sessionId],
		references: [paperSessions.id]
	}),
}));

export const strategyDslFeaturesRelations = relations(strategyDslFeatures, ({one}) => ({
	strategy: one(strategies, {
		fields: [strategyDslFeatures.strategyId],
		references: [strategies.id]
	}),
}));

export const tradingviewMarkersRelations = relations(tradingviewMarkers, ({one}) => ({
	strategy: one(strategies, {
		fields: [tradingviewMarkers.strategyId],
		references: [strategies.id]
	}),
	brokerAccount: one(brokerAccounts, {
		fields: [tradingviewMarkers.accountId],
		references: [brokerAccounts.accountId]
	}),
}));

export const strategyLockoutsRelations = relations(strategyLockouts, ({one}) => ({
	strategy: one(strategies, {
		fields: [strategyLockouts.strategyId],
		references: [strategies.id]
	}),
}));

export const complianceReviewsRelations = relations(complianceReviews, ({one}) => ({
	strategy: one(strategies, {
		fields: [complianceReviews.strategyId],
		references: [strategies.id]
	}),
	complianceRuleset: one(complianceRulesets, {
		fields: [complianceReviews.rulesetId],
		references: [complianceRulesets.id]
	}),
}));

export const complianceRulesetsRelations = relations(complianceRulesets, ({many}) => ({
	complianceReviews: many(complianceReviews),
	complianceDriftLogs: many(complianceDriftLog),
}));

export const backtestProvenanceRelations = relations(backtestProvenance, ({one}) => ({
	backtest: one(backtests, {
		fields: [backtestProvenance.backtestId],
		references: [backtests.id]
	}),
}));

export const backtestsRelations = relations(backtests, ({one, many}) => ({
	backtestProvenances: many(backtestProvenance),
	quboTimingRuns: many(quboTimingRuns),
	strategy: one(strategies, {
		fields: [backtests.strategyId],
		references: [strategies.id]
	}),
	systemJournals: many(systemJournal),
	backtestTrades: many(backtestTrades),
	cloudQmcRuns: many(cloudQmcRuns),
	criticOptimizationRuns_backtestId: many(criticOptimizationRuns, {
		relationName: "criticOptimizationRuns_backtestId_backtests_id"
	}),
	criticOptimizationRuns_survivorBacktestId: many(criticOptimizationRuns, {
		relationName: "criticOptimizationRuns_survivorBacktestId_backtests_id"
	}),
	frankensteinTestRuns: many(frankensteinTestRuns),
	monteCarloRuns: many(monteCarloRuns),
	quantumMcRuns: many(quantumMcRuns),
	quantumRunCosts: many(quantumRunCosts),
	shadowRerunFindings: many(shadowRerunFindings),
	sqaOptimizationRuns: many(sqaOptimizationRuns),
	stressTestRuns: many(stressTestRuns),
	syntheticBlackSwanRuns: many(syntheticBlackSwanRuns),
	tensorPredictions: many(tensorPredictions),
	tournamentResults: many(tournamentResults),
	walkForwardWindows: many(walkForwardWindows),
	strategyExports: many(strategyExports),
	criticCandidates: many(criticCandidates),
	lifecycleTransitions: many(lifecycleTransitions),
	adversarialStressRuns: many(adversarialStressRuns),
	strategySignalVectors: many(strategySignalVectors),
}));

export const strategyPendingBucketsRelations = relations(strategyPendingBuckets, ({one, many}) => ({
	strategy: one(strategies, {
		fields: [strategyPendingBuckets.graduatedStrategyId],
		references: [strategies.id]
	}),
	strategyPendingMentions: many(strategyPendingMentions),
}));

export const strategyPendingMentionsRelations = relations(strategyPendingMentions, ({one}) => ({
	strategyPendingBucket: one(strategyPendingBuckets, {
		fields: [strategyPendingMentions.bucketId],
		references: [strategyPendingBuckets.id]
	}),
}));

export const langchainPgEmbeddingRelations = relations(langchainPgEmbedding, ({one}) => ({
	langchainPgCollection: one(langchainPgCollection, {
		fields: [langchainPgEmbedding.collectionId],
		references: [langchainPgCollection.uuid]
	}),
}));

export const langchainPgCollectionRelations = relations(langchainPgCollection, ({many}) => ({
	langchainPgEmbeddings: many(langchainPgEmbedding),
}));

export const quboTimingRunsRelations = relations(quboTimingRuns, ({one}) => ({
	backtest: one(backtests, {
		fields: [quboTimingRuns.backtestId],
		references: [backtests.id]
	}),
	strategy: one(strategies, {
		fields: [quboTimingRuns.strategyId],
		references: [strategies.id]
	}),
}));

export const strategyFirmEligibilityRelations = relations(strategyFirmEligibility, ({one}) => ({
	strategy: one(strategies, {
		fields: [strategyFirmEligibility.strategyId],
		references: [strategies.id]
	}),
}));

export const skipDecisionsRelations = relations(skipDecisions, ({one}) => ({
	strategy: one(strategies, {
		fields: [skipDecisions.strategyId],
		references: [strategies.id]
	}),
}));

export const strategyGraveyardRelations = relations(strategyGraveyard, ({one}) => ({
	strategy: one(strategies, {
		fields: [strategyGraveyard.strategyId],
		references: [strategies.id]
	}),
}));

export const pilotSessionsRelations = relations(pilotSessions, ({one}) => ({
	strategy: one(strategies, {
		fields: [pilotSessions.strategyId],
		references: [strategies.id]
	}),
	paperSession: one(paperSessions, {
		fields: [pilotSessions.paperSessionId],
		references: [paperSessions.id]
	}),
}));

export const biasStateRelations = relations(biasState, ({one}) => ({
	strategy: one(strategies, {
		fields: [biasState.activeStrategyId],
		references: [strategies.id]
	}),
}));

export const quantumMcBenchmarksRelations = relations(quantumMcBenchmarks, ({one}) => ({
	quantumMcRun: one(quantumMcRuns, {
		fields: [quantumMcBenchmarks.quantumRunId],
		references: [quantumMcRuns.id]
	}),
	monteCarloRun: one(monteCarloRuns, {
		fields: [quantumMcBenchmarks.classicalRunId],
		references: [monteCarloRuns.id]
	}),
}));

export const quantumMcRunsRelations = relations(quantumMcRuns, ({one, many}) => ({
	quantumMcBenchmarks: many(quantumMcBenchmarks),
	backtest: one(backtests, {
		fields: [quantumMcRuns.backtestId],
		references: [backtests.id]
	}),
}));

export const monteCarloRunsRelations = relations(monteCarloRuns, ({one, many}) => ({
	quantumMcBenchmarks: many(quantumMcBenchmarks),
	backtest: one(backtests, {
		fields: [monteCarloRuns.backtestId],
		references: [backtests.id]
	}),
}));

export const promptAbTestsRelations = relations(promptAbTests, ({one}) => ({
	promptVersion_versionAId: one(promptVersions, {
		fields: [promptAbTests.versionAId],
		references: [promptVersions.id],
		relationName: "promptAbTests_versionAId_promptVersions_id"
	}),
	promptVersion_versionBId: one(promptVersions, {
		fields: [promptAbTests.versionBId],
		references: [promptVersions.id],
		relationName: "promptAbTests_versionBId_promptVersions_id"
	}),
}));

export const promptVersionsRelations = relations(promptVersions, ({many}) => ({
	promptAbTests_versionAId: many(promptAbTests, {
		relationName: "promptAbTests_versionAId_promptVersions_id"
	}),
	promptAbTests_versionBId: many(promptAbTests, {
		relationName: "promptAbTests_versionBId_promptVersions_id"
	}),
}));

export const strategyNamesRelations = relations(strategyNames, ({one}) => ({
	strategy: one(strategies, {
		fields: [strategyNames.strategyId],
		references: [strategies.id]
	}),
}));

export const systemParameterHistoryRelations = relations(systemParameterHistory, ({one}) => ({
	systemParameter_paramId: one(systemParameters, {
		fields: [systemParameterHistory.paramId],
		references: [systemParameters.id],
		relationName: "systemParameterHistory_paramId_systemParameters_id"
	}),
	systemParameter_paramId: one(systemParameters, {
		fields: [systemParameterHistory.paramId],
		references: [systemParameters.id],
		relationName: "systemParameterHistory_paramId_systemParameters_id"
	}),
}));

export const systemParametersRelations = relations(systemParameters, ({many}) => ({
	systemParameterHistories_paramId: many(systemParameterHistory, {
		relationName: "systemParameterHistory_paramId_systemParameters_id"
	}),
	systemParameterHistories_paramId: many(systemParameterHistory, {
		relationName: "systemParameterHistory_paramId_systemParameters_id"
	}),
}));

export const backtestMatrixRelations = relations(backtestMatrix, ({one, many}) => ({
	strategy: one(strategies, {
		fields: [backtestMatrix.strategyId],
		references: [strategies.id]
	}),
	backtestTrades: many(backtestTrades),
}));

export const systemJournalRelations = relations(systemJournal, ({one}) => ({
	strategy: one(strategies, {
		fields: [systemJournal.strategyId],
		references: [strategies.id]
	}),
	backtest: one(backtests, {
		fields: [systemJournal.backtestId],
		references: [backtests.id]
	}),
}));

export const rlTrainingRunsRelations = relations(rlTrainingRuns, ({one}) => ({
	strategy: one(strategies, {
		fields: [rlTrainingRuns.strategyId],
		references: [strategies.id]
	}),
}));

export const mutationOutcomesRelations = relations(mutationOutcomes, ({one}) => ({
	strategy: one(strategies, {
		fields: [mutationOutcomes.strategyId],
		references: [strategies.id]
	}),
}));

export const paperSessionFeedbackRelations = relations(paperSessionFeedback, ({one}) => ({
	paperSession: one(paperSessions, {
		fields: [paperSessionFeedback.sessionId],
		references: [paperSessions.id]
	}),
	strategy: one(strategies, {
		fields: [paperSessionFeedback.strategyId],
		references: [strategies.id]
	}),
}));

export const shadowSignalsRelations = relations(shadowSignals, ({one}) => ({
	paperSession: one(paperSessions, {
		fields: [shadowSignals.sessionId],
		references: [paperSessions.id]
	}),
}));

export const paperSignalLogsRelations = relations(paperSignalLogs, ({one}) => ({
	paperSession: one(paperSessions, {
		fields: [paperSignalLogs.sessionId],
		references: [paperSessions.id]
	}),
}));

export const complianceDriftLogRelations = relations(complianceDriftLog, ({one}) => ({
	complianceRuleset: one(complianceRulesets, {
		fields: [complianceDriftLog.rulesetId],
		references: [complianceRulesets.id]
	}),
}));

export const backtestTradesRelations = relations(backtestTrades, ({one}) => ({
	backtest: one(backtests, {
		fields: [backtestTrades.backtestId],
		references: [backtests.id]
	}),
	backtestMatrix: one(backtestMatrix, {
		fields: [backtestTrades.matrixId],
		references: [backtestMatrix.id]
	}),
}));

export const cloudQmcRunsRelations = relations(cloudQmcRuns, ({one, many}) => ({
	backtest: one(backtests, {
		fields: [cloudQmcRuns.backtestId],
		references: [backtests.id]
	}),
	strategy: one(strategies, {
		fields: [cloudQmcRuns.strategyId],
		references: [strategies.id]
	}),
	lifecycleTransitions: many(lifecycleTransitions),
}));

export const criticOptimizationRunsRelations = relations(criticOptimizationRuns, ({one, many}) => ({
	strategy: one(strategies, {
		fields: [criticOptimizationRuns.strategyId],
		references: [strategies.id]
	}),
	backtest_backtestId: one(backtests, {
		fields: [criticOptimizationRuns.backtestId],
		references: [backtests.id],
		relationName: "criticOptimizationRuns_backtestId_backtests_id"
	}),
	criticCandidate: one(criticCandidates, {
		fields: [criticOptimizationRuns.survivorCandidateId],
		references: [criticCandidates.id],
		relationName: "criticOptimizationRuns_survivorCandidateId_criticCandidates_id"
	}),
	backtest_survivorBacktestId: one(backtests, {
		fields: [criticOptimizationRuns.survivorBacktestId],
		references: [backtests.id],
		relationName: "criticOptimizationRuns_survivorBacktestId_backtests_id"
	}),
	criticCandidates: many(criticCandidates, {
		relationName: "criticCandidates_runId_criticOptimizationRuns_id"
	}),
}));

export const criticCandidatesRelations = relations(criticCandidates, ({one, many}) => ({
	criticOptimizationRuns: many(criticOptimizationRuns, {
		relationName: "criticOptimizationRuns_survivorCandidateId_criticCandidates_id"
	}),
	criticOptimizationRun: one(criticOptimizationRuns, {
		fields: [criticCandidates.runId],
		references: [criticOptimizationRuns.id],
		relationName: "criticCandidates_runId_criticOptimizationRuns_id"
	}),
	strategy: one(strategies, {
		fields: [criticCandidates.strategyId],
		references: [strategies.id]
	}),
	backtest: one(backtests, {
		fields: [criticCandidates.replayBacktestId],
		references: [backtests.id]
	}),
}));

export const frankensteinTestRunsRelations = relations(frankensteinTestRuns, ({one}) => ({
	backtest: one(backtests, {
		fields: [frankensteinTestRuns.backtestId],
		references: [backtests.id]
	}),
	strategy: one(strategies, {
		fields: [frankensteinTestRuns.strategyId],
		references: [strategies.id]
	}),
}));

export const quantumRunCostsRelations = relations(quantumRunCosts, ({one}) => ({
	backtest: one(backtests, {
		fields: [quantumRunCosts.backtestId],
		references: [backtests.id]
	}),
	strategy: one(strategies, {
		fields: [quantumRunCosts.strategyId],
		references: [strategies.id]
	}),
}));

export const shadowRerunFindingsRelations = relations(shadowRerunFindings, ({one}) => ({
	strategy: one(strategies, {
		fields: [shadowRerunFindings.strategyId],
		references: [strategies.id]
	}),
	backtest: one(backtests, {
		fields: [shadowRerunFindings.backtestId],
		references: [backtests.id]
	}),
}));

export const sqaOptimizationRunsRelations = relations(sqaOptimizationRuns, ({one}) => ({
	backtest: one(backtests, {
		fields: [sqaOptimizationRuns.backtestId],
		references: [backtests.id]
	}),
	strategy: one(strategies, {
		fields: [sqaOptimizationRuns.strategyId],
		references: [strategies.id]
	}),
}));

export const stressTestRunsRelations = relations(stressTestRuns, ({one}) => ({
	backtest: one(backtests, {
		fields: [stressTestRuns.backtestId],
		references: [backtests.id]
	}),
}));

export const syntheticBlackSwanRunsRelations = relations(syntheticBlackSwanRuns, ({one}) => ({
	strategy: one(strategies, {
		fields: [syntheticBlackSwanRuns.strategyId],
		references: [strategies.id]
	}),
	backtest: one(backtests, {
		fields: [syntheticBlackSwanRuns.backtestId],
		references: [backtests.id]
	}),
	syntheticRegimeBank: one(syntheticRegimeBank, {
		fields: [syntheticBlackSwanRuns.worstRegimeId],
		references: [syntheticRegimeBank.id]
	}),
}));

export const syntheticRegimeBankRelations = relations(syntheticRegimeBank, ({many}) => ({
	syntheticBlackSwanRuns: many(syntheticBlackSwanRuns),
}));

export const tensorPredictionsRelations = relations(tensorPredictions, ({one}) => ({
	backtest: one(backtests, {
		fields: [tensorPredictions.backtestId],
		references: [backtests.id]
	}),
	strategy: one(strategies, {
		fields: [tensorPredictions.strategyId],
		references: [strategies.id]
	}),
}));

export const tournamentResultsRelations = relations(tournamentResults, ({one}) => ({
	backtest: one(backtests, {
		fields: [tournamentResults.backtestId],
		references: [backtests.id]
	}),
}));

export const walkForwardWindowsRelations = relations(walkForwardWindows, ({one}) => ({
	backtest: one(backtests, {
		fields: [walkForwardWindows.backtestId],
		references: [backtests.id]
	}),
}));

export const strategyExportsRelations = relations(strategyExports, ({one, many}) => ({
	strategy: one(strategies, {
		fields: [strategyExports.strategyId],
		references: [strategies.id]
	}),
	backtest: one(backtests, {
		fields: [strategyExports.backtestId],
		references: [backtests.id]
	}),
	strategyExportArtifacts: many(strategyExportArtifacts),
}));

export const lifecycleTransitionsRelations = relations(lifecycleTransitions, ({one}) => ({
	strategy: one(strategies, {
		fields: [lifecycleTransitions.strategyId],
		references: [strategies.id]
	}),
	backtest: one(backtests, {
		fields: [lifecycleTransitions.backtestId],
		references: [backtests.id]
	}),
	cloudQmcRun: one(cloudQmcRuns, {
		fields: [lifecycleTransitions.cloudQmcRunId],
		references: [cloudQmcRuns.id]
	}),
}));

export const adversarialStressRunsRelations = relations(adversarialStressRuns, ({one}) => ({
	backtest: one(backtests, {
		fields: [adversarialStressRuns.backtestId],
		references: [backtests.id]
	}),
	strategy: one(strategies, {
		fields: [adversarialStressRuns.strategyId],
		references: [strategies.id]
	}),
}));

export const strategySignalVectorsRelations = relations(strategySignalVectors, ({one}) => ({
	strategy: one(strategies, {
		fields: [strategySignalVectors.strategyId],
		references: [strategies.id]
	}),
	backtest: one(backtests, {
		fields: [strategySignalVectors.backtestId],
		references: [backtests.id]
	}),
}));

export const strategyExportArtifactsRelations = relations(strategyExportArtifacts, ({one}) => ({
	strategyExport: one(strategyExports, {
		fields: [strategyExportArtifacts.exportId],
		references: [strategyExports.id]
	}),
}));

export const productionTradesRelations = relations(productionTrades, ({one}) => ({
	biasDecision: one(biasDecisions, {
		fields: [productionTrades.biasDecisionId],
		references: [biasDecisions.id]
	}),
}));

export const biasDecisionsRelations = relations(biasDecisions, ({many}) => ({
	productionTrades: many(productionTrades),
}));
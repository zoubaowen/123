const ALLOWED_CAPI_ACTIONS = new Map<string, ReadonlySet<string>>([
  [
    'tcb',
    new Set([
      'DescribeEnvs',
      'DescribeEnvBaseInfo',
      'DescribeCloudBaseRunServers',
      'DescribeCloudBaseRunServerVersion',
      'DescribeCloudBaseRunServerVersionPodList',
      'DescribeCloudBaseRunResource',
      'DescribeCloudBaseRunResourceForExtend',
      'DescribeCloudBaseBuildService',
      'DescribeGatewayCurveData',
      'DescribePostpayPackageFreeQuotas',
      'DescribeBillingInfo',
      'DescribeWxCloudBaseRunEnvs',
      'DescribeWxCloudBaseRunSubNets',
      'DescribeWxCloudBaseRunVpc',
      'DescribeStandaloneGateway',
      'DescribeEndUserLoginStatistic',
      'DescribeDatabaseACL',
      'ModifyDatabaseACL',
      'ModifyEnv',
    ]),
  ],
])

export function isAllowedCapiAction(service: string | undefined, action: string | undefined): boolean {
  if (!service || !action) return false
  return ALLOWED_CAPI_ACTIONS.get(service.toLowerCase())?.has(action) === true
}

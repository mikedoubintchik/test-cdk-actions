import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3'; 
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as route53 from 'aws-cdk-lib/aws-route53'; 
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

const DOMAIN_NAME = "elvisbrevi.com";
const WWW_DOMAIN_NAME = `www.${DOMAIN_NAME}`;

export class IacStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const staticWebsiteBucket = new s3.Bucket(this, `bucket-${id}`, {
      websiteIndexDocument: 'index.html',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: `static-site-${id}`.toLowerCase()
    });

    const hostedZone = route53.HostedZone.fromLookup(
      this, `HostedZone`, { domainName: DOMAIN_NAME }
    );

    const httpsCertificate = new acm.Certificate(this, `cert-${id}`, {
      domainName: DOMAIN_NAME,
      subjectAlternativeNames: [WWW_DOMAIN_NAME],
      validation: acm.CertificateValidation.fromDns(hostedZone),
      certificateName: `Certificate-${id}`,
    });

    const oac = new cloudfront.CfnOriginAccessControl(this, `oac-${id}`, {
      originAccessControlConfig: {
          name: `StaticWebOriginAccessControl`,
          originAccessControlOriginType: 's3',
          signingBehavior: 'always',
          signingProtocol: 'sigv4',
      },
    });

    const cloudFrontDistribution = new cloudfront.CloudFrontWebDistribution(this, `dist-${id}`, {
      defaultRootObject: 'index.html',
      viewerCertificate: cloudfront.ViewerCertificate.fromAcmCertificate(httpsCertificate, {
          aliases: [DOMAIN_NAME, WWW_DOMAIN_NAME]
      }),
      originConfigs: [{
          s3OriginSource: {
              s3BucketSource: staticWebsiteBucket
          },
          behaviors: [{
              isDefaultBehavior: true,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          }]
      }],
      errorConfigurations: [{
          errorCode: 403,
          responsePagePath: '/index.html',
          responseCode: 200,
          errorCachingMinTtl: 60
      }]
    });

    const cfnDistribution = cloudFrontDistribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.getAtt('Id'));

    staticWebsiteBucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
          effect: cdk.aws_iam.Effect.ALLOW,
          principals: [new cdk.aws_iam.ServicePrincipal('cloudfront.amazonaws.com')],
          actions: ['s3:GetObject'], 
          resources: [`${staticWebsiteBucket.bucketArn}/*`],
          conditions: {
            StringEquals: {
              'AWS:SourceArn': `arn:aws:cloudfront::${ cdk.Aws.ACCOUNT_ID }:distribution/${cloudFrontDistribution.distributionId}`
            },
          }
      })
    );

    new route53.ARecord(this, `aRecord-${id}`, {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new CloudFrontTarget(cloudFrontDistribution)),
      recordName: DOMAIN_NAME
    });

    new route53.ARecord(this, `aRecordwww-${id}`, {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new CloudFrontTarget(cloudFrontDistribution)),
      recordName: WWW_DOMAIN_NAME
    });

    new s3deploy.BucketDeployment(this, `bucketDeploy-${id}`, {
      sources: [s3deploy.Source.asset('../frontend/dist')], 
      destinationBucket: staticWebsiteBucket,
      distributionPaths: ['/*'], 
      distribution: cloudFrontDistribution
    });

  }
}